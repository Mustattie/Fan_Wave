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
// Persistence: pending jobs are mirrored to AsyncStorage so navigating away
// and back doesn't lose the placeholder. Full-app-kill recovery (resume an
// interrupted upload after process death) is deferred to v7.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { uploadClip } from './storage';
import { reportError } from './errorReporting';

const PENDING_KEY = 'clipUploads.pending.v1';
const MAX_CONCURRENT = 2;

export type UploadStatus = 'queued' | 'uploading' | 'inserting' | 'failed';

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
}

export interface JobState extends PendingClipJob {
  status?: UploadStatus;
  progress: number;
  error?: string;
  realId?: string;
  mediaUrl?: string;
}

type Listener = (state: JobState) => void;

const listeners = new Set<Listener>();
const jobs = new Map<string, JobState>();
let inFlight = 0;

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

async function persistPending(): Promise<void> {
  const pending = Array.from(jobs.values())
    .filter((j) => j.status !== 'failed')
    .map((j) => ({
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
    }));
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (e) {
    reportError(e, { source: 'clipUploads.persist' });
  }
}

export async function rehydratePending(): Promise<PendingClipJob[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingClipJob[]) : [];
  } catch {
    return [];
  }
}

export function generateTempId(): string {
  return `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function enqueueClipUpload(job: PendingClipJob): JobState {
  const initial: JobState = { ...job, status: 'queued', progress: 0 };
  emit(initial);
  void persistPending();
  void tryRun();
  return initial;
}

export function retryClipUpload(tempId: string): void {
  const existing = jobs.get(tempId);
  if (!existing) return;
  emit({ ...existing, status: 'queued', progress: 0, error: undefined });
  void persistPending();
  void tryRun();
}

export function cancelClipUpload(tempId: string): void {
  const existing = jobs.get(tempId);
  jobs.delete(tempId);
  // Fire a "cleared" event so subscribers can drop the placeholder. Status
  // is intentionally undefined to signal removal.
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
  void persistPending();
}

async function tryRun(): Promise<void> {
  if (inFlight >= MAX_CONCURRENT) return;
  const next = Array.from(jobs.values()).find((j) => j.status === 'queued');
  if (!next) return;

  inFlight++;
  emit({ ...next, status: 'uploading', progress: 0 });

  try {
    const { publicUrl } = await uploadClip(next.localUri, {
      contentType: next.contentType,
      subpath: next.subpath,
      onProgress: (pct: number) => {
        const cur = jobs.get(next.tempId);
        if (!cur || cur.status !== 'uploading') return;
        emit({ ...cur, progress: Math.max(0, Math.min(99, Math.round(pct))) });
      },
    });

    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'inserting',
      progress: 99,
      mediaUrl: publicUrl,
    });

    const { data: row, error } = await supabase
      .from('media_clips')
      .insert({
        user_id: next.userId,
        title: next.title,
        description: next.description,
        media_url: publicUrl,
        media_type: 'video',
        duration_seconds: next.durationSeconds,
        sport_id: next.sportId,
        moment_type: next.momentType,
      })
      .select('*')
      .single();
    if (error) throw error;

    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'inserting',
      progress: 100,
      realId: row.id,
      mediaUrl: publicUrl,
    });
    jobs.delete(next.tempId);
    await persistPending();
  } catch (e: any) {
    reportError(e, { source: 'clipUploads.run', tempId: next.tempId });
    emit({
      ...(jobs.get(next.tempId) || next),
      status: 'failed',
      error: e?.message || 'Upload failed',
    });
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
