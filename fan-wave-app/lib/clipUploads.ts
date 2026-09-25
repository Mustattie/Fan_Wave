// Background upload queue for clip posts.
//
// Decouples the Post-button tap from the 30s+ Storage upload + DB insert,
// so the user sees their clip in the feed instantly (an "uploading"
// placeholder) and the network work happens out-of-band. Eliminates the
// ~60s feed lag reported on live Android v5.
//
// Concurrency cap: 2 in-flight uploads per device. During live matches
// users post bursts (trim a clip, post, immediately trim another). Letting
// all of them upload at once would saturate the cellular link; 2 is enough
// that the next clip starts while the first finishes the last few MB.
//
// Persistence and recovery (Phase 1, 2026-09-16 scalability review):
// jobs are mirrored to AsyncStorage, and -- this is the part that was
// missing -- read back on the next launch by initClipUploads(). Before,
// rehydratePending() existed but nothing called it, so a process kill in
// the camera (the memory peak of the whole app) lost the upload with no
// card, no error and an orphaned object in the bucket. Now:
//
//   * a job that was queued / uploading / inserting when the process died
//     comes back as queued and runs again, under a FRESH storage path;
//   * a job that had already failed comes back as failed, with its Retry
//     button, instead of disappearing;
//   * a job whose local file is gone comes back as failed with a message
//     that says so -- the one case we genuinely cannot resume;
//   * when the app returns to the foreground, a job that failed on a
//     timeout or a network drop is retried once automatically (iOS
//     suspends the upload task in the background, so a long camera trip
//     reliably produced exactly that failure).
//
// Every retry, manual or automatic, uploads to a new path. The Storage
// call sends x-upsert:false, so re-using the old path after a timeout that
// the server had in fact completed answered 409 forever.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { uploadClip, deleteClipAssets, deleteLocalFile, fileExists } from './storage';
import { addBreadcrumb, reportError, reportMessage } from './errorReporting';
import { withTimeout } from './withTimeout';
import { trackEvent } from './analytics';
import { isFeatureEnabled } from './killSwitches';

const PENDING_KEY_V1 = 'clipUploads.pending.v1';
const PENDING_KEY = 'clipUploads.pending.v2';
const MAX_CONCURRENT = 2;
// Stability fix 6 (2026-09-23): a failed job used to come back on every
// launch forever, each one pinning its recorded video on disk through the
// localUri it carries. A week is long enough to come back to a failed post;
// past that the job is dropped and the recording it referenced is removed.
const FAILED_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// The Storage upload is already bounded (UPLOAD_TIMEOUT_MS in storage.ts).
// The row insert that follows it was not, and a PostgREST call that never
// settles would have parked the job in 'inserting' with no terminal state
// and no way for the feed to offer a retry -- one of the two ways a card
// could sit on "Posting..." forever (iOS UAT 2026-09-09, BUG-4). 30s is
// generous for a single-row insert; past that the connection is gone.
const INSERT_TIMEOUT_MS = 30_000;
// P3.1: after this many failed attempts on one job the failure is reported
// as its own Sentry event (clips.retry_exhausted).
const RETRY_EXHAUSTED_AT_ATTEMPT = 3;

export type UploadStatus = 'queued' | 'uploading' | 'inserting' | 'failed';

/** Why a job failed, for telemetry and for deciding whether to auto-retry. */
export type UploadErrorKind =
  | 'timeout'
  | 'network'
  | 'server'
  | 'auth'
  | 'client'
  | 'file_missing'
  | 'paused'
  | 'unknown';

export interface PendingClipJob {
  tempId: string;
  localUri: string;
  contentType: string;
  subpath: string;
  title: string;
  description: string;
  sportId: string;
  momentType: string | null;
  durationSeconds: number | null;
  userId: string;
  profileId: string;
  displayName: string;
  createdAt: string;
  /** v9.4.4: local file:// still frame produced by expo-video-thumbnails at
   *  post time. Uploaded next to the video so the feed can show a real
   *  preview on inactive cards. Optional -- thumbnail generation is
   *  best-effort and a clip posts fine without one. */
  localThumbnailUri?: string | null;
}

export interface JobState extends PendingClipJob {
  status?: UploadStatus;
  progress: number;
  error?: string;
  errorKind?: UploadErrorKind;
  realId?: string;
  mediaUrl?: string;
  thumbnailUrl?: string | null;
  /** How many times this job has been started (1 on the first run). */
  attempt?: number;
  /** True if this job was read back from disk after a restart. */
  recovered?: boolean;
  /** The one automatic foreground retry has been spent. */
  autoRetried?: boolean;
}

/** What goes to disk: the job plus enough state to bring it back honestly. */
interface PersistedJob extends PendingClipJob {
  status: 'queued' | 'failed';
  error?: string;
  errorKind?: UploadErrorKind;
  attempt?: number;
  autoRetried?: boolean;
  /** v9.5.23: the blob URL of an attempt that reached the row insert. On
   *  the next run the server is asked whether that row exists before
   *  anything is uploaded or inserted again (see reconcileByMediaUrl). */
  mediaUrl?: string;
  thumbnailUrl?: string | null;
}

type Listener = (state: JobState) => void;

const listeners = new Set<Listener>();
const jobs = new Map<string, JobState>();
let inFlight = 0;
let initializedForUser: string | null = null;
let appStateSubscription: { remove: () => void } | null = null;

export function subscribeToClipUploads(fn: Listener): () => void {
  listeners.add(fn);
  for (const j of jobs.values()) fn(j);
  return () => {
    listeners.delete(fn);
  };
}

function emit(state: JobState) {
  jobs.set(state.tempId, state);
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (e) {
      reportError(e, { source: 'clipUploads.emit' });
    }
  }
}

function emitRemoval(tempId: string, existing?: JobState) {
  for (const fn of listeners) {
    try {
      fn({
        ...(existing ?? ({} as JobState)),
        tempId,
        progress: 0,
        status: undefined,
      });
    } catch (e) {
      reportError(e, { source: 'clipUploads.cancel' });
    }
  }
}

function toPersisted(j: JobState): PersistedJob {
  return {
    tempId: j.tempId,
    localUri: j.localUri,
    contentType: j.contentType,
    subpath: j.subpath,
    title: j.title,
    description: j.description,
    sportId: j.sportId,
    momentType: j.momentType,
    durationSeconds: j.durationSeconds,
    userId: j.userId,
    profileId: j.profileId,
    displayName: j.displayName,
    createdAt: j.createdAt,
    localThumbnailUri: j.localThumbnailUri ?? null,
    // Anything in flight when the process dies must start over.
    status: j.status === 'failed' ? 'failed' : 'queued',
    error: j.error,
    errorKind: j.errorKind,
    attempt: j.attempt,
    autoRetried: j.autoRetried,
    mediaUrl: j.mediaUrl,
    thumbnailUrl: j.thumbnailUrl ?? null,
  };
}

/**
 * v9.5.23 (P3.5): the two duplicate paths -- an insert whose response was
 * lost after it committed, and a process killed between the insert and
 * the job's removal -- both end with a row on the server the client does
 * not know about. media_url is unique per attempt (timestamped subpath),
 * so asking for it settles the question. Returns the row id when the
 * clip already exists, null when it does not, and undefined when the
 * server could not be asked (the caller then keeps the conservative
 * path: treat the attempt as failed, do not delete the blob).
 */
async function reconcileByMediaUrl(mediaUrl: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await withTimeout(
      () => supabase.from('media_clips').select('id').eq('media_url', mediaUrl).maybeSingle(),
      10_000,
    );
    if (error) return undefined;
    return data?.id ?? null;
  } catch {
    return undefined;
  }
}

async function persistPending(): Promise<void> {
  const pending = Array.from(jobs.values())
    .filter((j) => !!j.status)
    .map(toPersisted);
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (e) {
    reportError(e, { source: 'clipUploads.persist' });
  }
}

/**
 * Read persisted jobs. Reads the v1 key too (written by builds before this
 * change, which never read it back) so an upload stranded by an older
 * build is recovered by this one; the v1 key is cleared after the read.
 */
export async function rehydratePending(): Promise<PersistedJob[]> {
  const out: PersistedJob[] = [];
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (raw) out.push(...(JSON.parse(raw) as PersistedJob[]));
  } catch {
    /* unreadable -- treat as empty */
  }
  try {
    const rawV1 = await AsyncStorage.getItem(PENDING_KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1) as PendingClipJob[];
      for (const j of v1) {
        if (!out.some((o) => o.tempId === j.tempId)) {
          out.push({ ...j, status: 'queued' });
        }
      }
      AsyncStorage.removeItem(PENDING_KEY_V1).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function generateTempId(): string {
  return `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** A new object path with the same extension. Never re-use a path. */
export function freshSubpath(previous: string): string {
  const ext = (previous.split('.').pop() || 'mp4').toLowerCase();
  return `${Date.now()}.${ext}`;
}

export function classifyUploadError(e: unknown): UploadErrorKind {
  const msg = String((e as any)?.message ?? e ?? '');
  if (msg.startsWith('Timeout after') || msg.startsWith('Upload timed out')) return 'timeout';
  if (msg === 'Not signed in') return 'auth';
  const status = msg.match(/Upload failed \((\d{3})\)/);
  if (status) {
    const code = Number(status[1]);
    if (code === 401 || code === 403) return 'auth';
    if (code >= 500) return 'server';
    return 'client';
  }
  if (/network request failed|network error|failed to fetch|econn|socket|unreachable/i.test(msg)) {
    return 'network';
  }
  return 'unknown';
}

function isTransient(kind: UploadErrorKind | undefined): boolean {
  return kind === 'timeout' || kind === 'network' || kind === 'server';
}

function friendlyMessage(kind: UploadErrorKind, raw: string): string {
  switch (kind) {
    case 'timeout':
    case 'network':
      return 'The connection dropped before this finished. Tap Retry when you have signal.';
    case 'server':
      return 'The server had a problem. Tap Retry in a moment.';
    case 'auth':
      return 'Your session needed a refresh. Tap Retry to post this clip.';
    case 'file_missing':
      return 'The original video is no longer on this device, so this upload cannot be resumed.';
    case 'paused':
      return 'Clip uploads are paused for a moment while we handle a surge. Your clip is saved here; tap Retry soon.';
    default:
      return raw || 'Upload failed.';
  }
}

export function enqueueClipUpload(job: PendingClipJob): JobState {
  // P3.3 kill switch: the recording is kept as a failed job with Retry,
  // so nothing the user made is lost while uploads are paused.
  if (!isFeatureEnabled('clips_upload')) {
    const paused: JobState = {
      ...job,
      status: 'failed',
      progress: 0,
      attempt: 0,
      errorKind: 'paused',
      error: friendlyMessage('paused', ''),
    };
    emit(paused);
    addBreadcrumb('clips', 'upload.paused_by_switch', { tempId: job.tempId });
    void persistPending();
    return paused;
  }
  const initial: JobState = { ...job, status: 'queued', progress: 0, attempt: 0 };
  emit(initial);
  addBreadcrumb('clips', 'upload.enqueued', { tempId: job.tempId });
  void persistPending();
  void tryRun();
  return initial;
}

export function retryClipUpload(tempId: string, source: 'manual' | 'auto' = 'manual'): void {
  const existing = jobs.get(tempId);
  if (!existing) return;
  // v9.5.23: only a failed job can be retried. A second call while the
  // job is queued/uploading/inserting (double tap, or the foreground
  // resume racing a manual tap) used to reset it to 'queued' and start a
  // second concurrent upload of the same recording -- two blobs, two rows.
  if (existing.status !== 'failed') return;
  // Fresh path every time: the previous attempt may have completed on the
  // server after our timeout fired, and x-upsert:false would 409 on it.
  emit({
    ...existing,
    status: 'queued',
    progress: 0,
    error: undefined,
    errorKind: undefined,
    subpath: freshSubpath(existing.subpath),
    autoRetried: existing.autoRetried || source === 'auto',
  });
  void trackEvent('clip_upload_retried', 'clips', {
    source,
    attempt: existing.attempt ?? 0,
    previous_error: existing.errorKind ?? null,
  });
  addBreadcrumb('clips', 'upload.retried', { tempId, source });
  void persistPending();
  void tryRun();
}

export function cancelClipUpload(tempId: string): void {
  const existing = jobs.get(tempId);
  jobs.delete(tempId);
  // Fire a "cleared" event so subscribers can drop the placeholder. Status
  // is intentionally undefined to signal removal.
  emitRemoval(tempId, existing);
  addBreadcrumb('clips', 'upload.cancelled', { tempId });
  void persistPending();
}

/**
 * Bring back whatever was on disk for this user and start listening for
 * foreground transitions. Call once the session is known (root layout).
 * Safe to call again for the same user; a different user replaces the
 * in-memory queue.
 */
export async function initClipUploads(userId: string): Promise<void> {
  if (initializedForUser === userId) return;
  initializedForUser = userId;

  // A previous account's jobs must not run under this one.
  for (const j of Array.from(jobs.values())) {
    if (j.userId !== userId) {
      jobs.delete(j.tempId);
      emitRemoval(j.tempId, j);
    }
  }

  const persisted = await rehydratePending();
  let resumed = 0;
  let restoredFailed = 0;
  let fileMissing = 0;
  let dropped = 0;

  let expired = 0;
  for (const p of persisted) {
    if (jobs.has(p.tempId)) continue; // already live in memory (warm start)
    if (p.userId !== userId) {
      dropped += 1;
      continue;
    }
    if (p.status === 'failed' && Date.now() - new Date(p.createdAt).getTime() > FAILED_JOB_TTL_MS) {
      expired += 1;
      void deleteLocalFile(p.localThumbnailUri);
      void deleteLocalFile(p.localUri);
      continue;
    }
    const videoOk = await fileExists(p.localUri);
    const thumbOk = p.localThumbnailUri ? await fileExists(p.localThumbnailUri) : false;
    const base: JobState = {
      ...p,
      localThumbnailUri: thumbOk ? p.localThumbnailUri : null,
      progress: 0,
      recovered: true,
      attempt: p.attempt ?? 0,
      autoRetried: p.autoRetried,
    };
    if (!videoOk) {
      fileMissing += 1;
      emit({
        ...base,
        status: 'failed',
        errorKind: 'file_missing',
        error: friendlyMessage('file_missing', ''),
      });
      continue;
    }
    if (p.status === 'failed') {
      restoredFailed += 1;
      emit({
        ...base,
        status: 'failed',
        errorKind: p.errorKind ?? 'unknown',
        error: p.error ?? friendlyMessage(p.errorKind ?? 'unknown', ''),
      });
      continue;
    }
    resumed += 1;
    emit({ ...base, status: 'queued', subpath: freshSubpath(p.subpath) });
  }

  if (persisted.length > 0) {
    void trackEvent('clip_upload_recovered', 'clips', {
      found: persisted.length,
      resumed,
      restored_failed: restoredFailed,
      file_missing: fileMissing,
      dropped,
      expired,
    });
    addBreadcrumb('clips', 'upload.recovered', {
      found: persisted.length,
      resumed,
      restoredFailed,
      fileMissing,
      dropped,
      expired,
    });
    // P3.1: recovery is an event, not only a breadcrumb -- a rising count
    // of resumed/file-missing jobs across devices is the signal that
    // uploads are dying mid-flight in the field.
    if (resumed + restoredFailed + fileMissing > 0) {
      reportMessage(
        'clips.upload_recovered',
        'info',
        { found: persisted.length, resumed, restoredFailed, fileMissing, dropped, expired },
        { clips_recovery: fileMissing > 0 ? 'file_missing' : resumed > 0 ? 'resumed' : 'restored_failed' },
      );
    }
  }

  await persistPending();
  void tryRun();

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeAfterForeground();
    });
  }
}

/**
 * On return to the foreground: kick any queued job, and give a job that
 * failed on a timeout / network drop / 5xx one automatic retry. Failures
 * that need the user (auth, a 4xx, a missing file) keep their Retry button.
 */
export function resumeAfterForeground(): void {
  for (const j of Array.from(jobs.values())) {
    if (j.status === 'failed' && isTransient(j.errorKind) && !j.autoRetried) {
      retryClipUpload(j.tempId, 'auto');
    }
  }
  void tryRun();
}

async function tryRun(): Promise<void> {
  if (inFlight >= MAX_CONCURRENT) return;
  // P3.3: restored/queued jobs wait while the switch is off; the next
  // foreground or manual Retry runs them once it is back on.
  if (!isFeatureEnabled('clips_upload')) return;
  const next = Array.from(jobs.values()).find((j) => j.status === 'queued');
  if (!next) return;

  inFlight++;
  const attempt = (next.attempt ?? 0) + 1;
  const startedAt = Date.now();
  emit({ ...next, status: 'uploading', progress: 0, attempt });
  void trackEvent('clip_upload_started', 'clips', {
    attempt,
    recovered: !!next.recovered,
  });
  addBreadcrumb('clips', 'upload.started', { tempId: next.tempId, attempt });

  try {
    // v9.5.23: a previous attempt got as far as the insert. If its row is
    // on the server this job is already done; do not upload a second blob
    // or insert a second row. If it is not, the old blob is dropped so it
    // does not become an orphan under the fresh subpath below.
    if (next.mediaUrl) {
      const existingId = await reconcileByMediaUrl(next.mediaUrl);
      if (existingId) {
        emit({
          ...(jobs.get(next.tempId) || next),
          status: 'inserting',
          progress: 100,
          realId: existingId,
          mediaUrl: next.mediaUrl,
          thumbnailUrl: next.thumbnailUrl ?? null,
        });
        jobs.delete(next.tempId);
        await persistPending();
        addBreadcrumb('clips', 'upload.reconciled', { tempId: next.tempId, found: true });
        void trackEvent('clip_upload_reconciled', 'clips', { found: true, attempt });
        return;
      }
      if (existingId === null) {
        await deleteClipAssets([next.mediaUrl, next.thumbnailUrl ?? null]);
        addBreadcrumb('clips', 'upload.reconciled', { tempId: next.tempId, found: false });
      }
      // undefined: could not ask; fall through and let the fresh attempt
      // (new subpath) decide. The stale blob is cleaned by the next
      // reconcile or the storage sweep.
    }

    const { publicUrl } = await uploadClip(next.localUri, {
      contentType: next.contentType,
      subpath: next.subpath,
      onProgress: (pct: number) => {
        const cur = jobs.get(next.tempId);
        if (!cur || cur.status !== 'uploading') return;
        emit({ ...cur, progress: Math.max(0, Math.min(99, Math.round(pct))) });
      },
    });

    // v9.4.4: ship the still frame alongside the video. Best-effort --
    // a failed thumbnail must never fail the post, it just means the card
    // falls back to the gradient placeholder as before.
    let thumbnailUrl: string | null = null;
    if (next.localThumbnailUri) {
      try {
        const thumb = await uploadClip(next.localThumbnailUri, {
          contentType: 'image/jpeg',
          subpath: next.subpath.replace(/\.[^.]+$/, '') + '.thumb.jpg',
        });
        thumbnailUrl = thumb.publicUrl;
        // Stability fix 6: the still frame is in the bucket now; the local
        // copy expo-video-thumbnails wrote was never deleted before.
        void deleteLocalFile(next.localThumbnailUri);
      } catch (e) {
        reportError(e, { source: 'clipUploads.thumbnail', tempId: next.tempId });
      }
    }

    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'inserting',
      progress: 99,
      mediaUrl: publicUrl,
      thumbnailUrl,
    });

    // The job is persisted with mediaUrl from here on, so a kill during
    // the insert is reconciled on the next launch instead of re-run.
    await persistPending();

    let row: { id: string } | null = null;
    let error: any = null;
    try {
      const res = await withTimeout(
        () => supabase
          .from('media_clips')
          .insert({
            user_id: next.userId,
            title: next.title,
            description: next.description,
            media_url: publicUrl,
            thumbnail_url: thumbnailUrl,
            media_type: 'video',
            duration_seconds: next.durationSeconds,
            sport_id: next.sportId,
            moment_type: next.momentType,
          })
          .select('*')
          .single(),
        INSERT_TIMEOUT_MS,
      );
      row = res.data as any;
      error = res.error;
    } catch (timeoutOrNetwork) {
      // v9.5.23: the insert may have committed even though the response
      // never arrived. Before this, the timeout skipped the cleanup below
      // (blob orphaned) and the retry inserted a second row.
      const existingId = await reconcileByMediaUrl(publicUrl);
      if (existingId) {
        row = { id: existingId };
        addBreadcrumb('clips', 'upload.insert_reconciled', { tempId: next.tempId });
      } else {
        if (existingId === null) await deleteClipAssets([publicUrl, thumbnailUrl]);
        throw timeoutOrNetwork;
      }
    }
    if (error || !row) {
      // v9.4.4: the blob is already in the bucket at this point. Before
      // this, a failed insert left it there forever AND a retry uploaded a
      // second copy under a fresh subpath -- that is where prod's 26
      // orphans (304 MB against 6 live clips) came from. Drop what we
      // just uploaded before surfacing the failure.
      await deleteClipAssets([publicUrl, thumbnailUrl]);
      throw error;
    }

    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'inserting',
      progress: 100,
      realId: row.id,
      mediaUrl: publicUrl,
      thumbnailUrl,
    });
    jobs.delete(next.tempId);
    await persistPending();

    const durationMs = Date.now() - startedAt;
    void trackEvent('clip_upload_succeeded', 'clips', {
      attempt,
      duration_ms: durationMs,
      recovered: !!next.recovered,
    });
    // The product event the admin activity screen has always listed but
    // nothing emitted (audit item 3).
    void trackEvent('clip_uploaded', 'clips', {
      sport_id: next.sportId || null,
      duration_seconds: next.durationSeconds ?? null,
      has_thumbnail: !!thumbnailUrl,
    });
    addBreadcrumb('clips', 'upload.succeeded', { tempId: next.tempId, attempt, durationMs });
  } catch (e: any) {
    reportError(e, { source: 'clipUploads.run', tempId: next.tempId, attempt });
    const kind = classifyUploadError(e);
    // This string is user-facing -- the feed renders it under
    // "Upload failed" on the card (BUG-4).
    const friendly = friendlyMessage(kind, e?.message || '');
    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'failed',
      error: friendly,
      errorKind: kind,
      attempt,
    });
    void trackEvent('clip_upload_failed', 'clips', {
      attempt,
      error_kind: kind,
      duration_ms: Date.now() - startedAt,
    });
    addBreadcrumb('clips', 'upload.failed', { tempId: next.tempId, attempt, kind });
    // P3.1: the outcome of retrying, as an event. Attempt 1 is already
    // captured by reportError above; a job that keeps failing is what
    // needs a human.
    if (attempt >= RETRY_EXHAUSTED_AT_ATTEMPT) {
      reportMessage(
        'clips.retry_exhausted',
        'warning',
        { tempId: next.tempId, attempt, kind, recovered: !!next.recovered },
        { clip_error_kind: kind },
      );
    }
    await persistPending();
  } finally {
    inFlight--;
    void tryRun();
  }
}

/** Active (queued/uploading/inserting) job count. UI uses this to cap bursts. */
export function activeUploadCount(): number {
  return Array.from(jobs.values()).filter(
    (j) =>
      j.status === 'uploading' || j.status === 'inserting' || j.status === 'queued',
  ).length;
}

/** Test hook. */
export function _resetClipUploadsForTests(): void {
  jobs.clear();
  listeners.clear();
  inFlight = 0;
  initializedForUser = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
}
