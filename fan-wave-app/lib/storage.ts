import {
  createUploadTask,
  deleteAsync,
  FileSystemUploadType,
  getInfoAsync,
} from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

// v9.2.5 UAT 2026-07-28: hard ceiling on a single upload. 25 MB clip at
// 3 Mbps cellular is ~70s; 90s leaves a small margin. If the native
// upload task truly hangs (cell drop, Supabase edge unreachable), the
// timeout fires, we call task.cancelAsync() to release the native
// thread, and the clipUploads queue can move on. Without this the
// entire app appears frozen — the queue slot is never released, the
// button spinner never resets, and the native thread churns on
// forever.
const UPLOAD_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Single storage abstraction. Currently backed by Supabase Storage; the
// future Cloudinary migration (FW-E18) swaps the implementation here without
// touching call sites in create-clip / MomentsFeed / etc.
// ---------------------------------------------------------------------------

export type StorageProvider = 'supabase' | 'cloudinary';

export interface UploadOptions {
  contentType: string;
  subpath: string; // e.g. 'moments/<timestamp>.mp4' — folder/ prefix is auto-added below auth.uid()
  /** Optional 0–100 progress callback. Used by the clip upload queue so
   *  the optimistic UI placeholder can render an accurate progress bar.
   *  Sampled every ~256 KB by expo-file-system's createUploadTask. */
  onProgress?: (pct: number) => void;
}

export interface UploadResult {
  publicUrl: string;
  provider: StorageProvider;
}

export interface ValidationOptions {
  maxBytes?: number;        // default 25 MB
  maxDurationSec?: number;  // default 30s
  durationSec?: number;     // pass from ImagePicker asset.duration / 1000
}

export class UploadValidationError extends Error {
  constructor(public reason: 'too_large' | 'too_long' | 'invalid_uri', message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

// v9.4.4: exported so the picker, the validator and the on-screen copy all
// read the SAME numbers. They used to be private here while create-clip
// hard-coded `videoMaxDuration: 30` separately -- two sources of truth for
// one promise to the user.
export const MAX_CLIP_BYTES = 25 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 30;

const DEFAULT_MAX_BYTES = MAX_CLIP_BYTES;
const DEFAULT_MAX_DURATION_SEC = MAX_CLIP_SECONDS;

function getProvider(): StorageProvider {
  const p = process.env.EXPO_PUBLIC_STORAGE_PROVIDER;
  return p === 'cloudinary' ? 'cloudinary' : 'supabase';
}

// ---------------------------------------------------------------------------
// Validation — called pre-upload so users get fast feedback instead of a
// slow server-side rejection.
// ---------------------------------------------------------------------------
export async function validateClip(uri: string, opts?: ValidationOptions): Promise<void> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDurationSec = opts?.maxDurationSec ?? DEFAULT_MAX_DURATION_SEC;

  if (opts?.durationSec !== undefined && opts.durationSec > maxDurationSec) {
    throw new UploadValidationError(
      'too_long',
      `Clip is ${Math.round(opts.durationSec)}s — please trim to ${maxDurationSec}s or less.`,
    );
  }

  let size: number | undefined;
  try {
    const info = await getInfoAsync(uri, { size: true } as any);
    size = (info as any).size as number | undefined;
  } catch {
    // Some URIs (e.g. content://) don't return a size cleanly. Let the
    // server reject in that case rather than blocking pre-upload.
    return;
  }
  if (typeof size === 'number' && size > maxBytes) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    throw new UploadValidationError(
      'too_large',
      `Clip is ${mb} MB — please trim under ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Upload — delegates to the configured provider.
// Folder structure: <auth.uid()>/<subpath>. Supabase Storage RLS (migration
// 021) requires the top-level folder to be the auth uid; we preserve that
// for Cloudinary too (just for symmetry — Cloudinary signed uploads enforce
// the path server-side).
// ---------------------------------------------------------------------------
export async function uploadClip(uri: string, opts: UploadOptions): Promise<UploadResult> {
  // Phase 1 (2026-09-16): getSession(), not getUser(). getUser() is a
  // network round-trip to /auth/v1/user on every upload, and with a token
  // that expired while the user sat in the camera it answers 401 before
  // the auto-refresh has had a chance to run. getSession() refreshes an
  // expired-with-margin token itself and hands back the user from the
  // JWT, so the bearer captured below is fresh at upload start.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  const accessToken = session?.access_token;
  if (!user || !accessToken) throw new Error('Not signed in');

  const path = `${user.id}/${opts.subpath}`;
  const provider = getProvider();

  if (provider === 'cloudinary') {
    return uploadToCloudinary(uri, path, opts.contentType);
  }
  return uploadToSupabase(uri, path, opts.contentType, accessToken, opts.onProgress);
}

/**
 * Does a local media URI still point at a file? Used by the upload queue
 * when it brings jobs back after a restart. Some URIs (Android content://)
 * cannot be stat'ed; those are treated as present so the upload gets to
 * try rather than being written off.
 */
export async function fileExists(uri: string): Promise<boolean> {
  if (!uri) return false;
  try {
    const info = await getInfoAsync(uri);
    return (info as any)?.exists !== false;
  } catch {
    return true;
  }
}

/**
 * Best-effort removal of a temp file the app itself created (a thumbnail
 * still, an export download). Never throws; only touches file:// URIs so a
 * content:// picker URI or a remote URL can never be handed to deleteAsync
 * by mistake. Stability fix 6: these were never cleaned up.
 */
export async function deleteLocalFile(uri: string | null | undefined): Promise<void> {
  if (!uri || !uri.startsWith('file://')) return;
  try {
    await deleteAsync(uri, { idempotent: true });
  } catch {
    /* best-effort */
  }
}

async function uploadToSupabase(
  uri: string,
  path: string,
  contentType: string,
  accessToken: string,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;

  // Native binary upload via expo-file-system createUploadTask — same
  // codepath as uploadAsync, but exposes a progressCallback so the clip
  // optimistic UI can paint an accurate "Posting… 42%" overlay.
  const task = createUploadTask(
    `${supabaseUrl}/storage/v1/object/clips/${path}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
        // P2.10 (2026-09-25): every object path is timestamp-unique and
        // never overwritten (x-upsert false), so the public URL is
        // immutable. Storage served the default max-age=3600, which made
        // the CDN re-validate every hour for every viewer.
        'cache-control': 'max-age=31536000',
      },
    },
    (p) => {
      if (!onProgress || !p.totalBytesExpectedToSend) return;
      onProgress((p.totalBytesSent / p.totalBytesExpectedToSend) * 100);
    },
  );
  let result: Awaited<ReturnType<typeof task.uploadAsync>> | undefined;
  try {
    result = await withTimeout(task.uploadAsync(), UPLOAD_TIMEOUT_MS);
  } catch (e: any) {
    // Native task keeps running until we explicitly cancel it. Do this
    // even for non-timeout errors so we don't leak the OS-level thread.
    try { await task.cancelAsync(); } catch { /* best-effort */ }
    // Phase 1: the server may have finished the PUT just as our timeout
    // fired. The queue retries under a fresh path (so no 409), which means
    // this one would be an orphan. Remove is idempotent and cheap; if the
    // object never existed, or the token is the problem, this just fails
    // quietly.
    try { await supabase.storage.from('clips').remove([path]); } catch { /* best-effort */ }
    if (e?.message?.startsWith('Timeout after')) {
      throw new Error('Upload timed out. Check your connection and try again.');
    }
    throw e;
  }
  if (!result) throw new Error('Upload returned no result');
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status}): ${result.body}`);
  }
  const { data } = supabase.storage.from('clips').getPublicUrl(path);
  return { publicUrl: data.publicUrl, provider: 'supabase' };
}

async function uploadToCloudinary(_uri: string, _path: string, _contentType: string): Promise<UploadResult> {
  // FW-109 implementation. Until then, we never get here because the
  // env var defaults to 'supabase'.
  throw new Error('Cloudinary provider not yet implemented — see FW-109');
}

// ---------------------------------------------------------------------------
// Blob lifecycle — v9.4.4.
//
// Storage was leaking on two paths and prod had 26 orphaned objects holding
// 304 MB against 6 live clips (91 MB) — 77% of the bucket was dead weight:
//
//   1. Both delete handlers (clips feed + my-clips) deleted the media_clips
//      row and never touched the object behind it.
//   2. clipUploads.tryRun() uploads first, then inserts the row. When the
//      insert failed the job was marked 'failed' with the blob already
//      uploaded — and a retry uploaded a SECOND copy under a new subpath.
//
// Both now call deleteClipAssets. Supabase Storage RLS (mig 021) scopes
// delete to the object's top-level folder being the caller's auth uid, so a
// user can only ever remove their own files.
// ---------------------------------------------------------------------------

/**
 * Recover the in-bucket path from a public URL.
 *
 * getPublicUrl produces
 *   <supabase>/storage/v1/object/public/clips/<uid>/<subpath>
 * and we need the "<uid>/<subpath>" tail. Returns null for anything that
 * isn't a clips-bucket URL (Cloudinary, a local file://, an empty column)
 * so callers can skip it rather than issue a bogus delete.
 */
export function clipPathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const marker = '/storage/v1/object/public/clips/';
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length).split('?')[0]!;
  return path ? decodeURIComponent(path) : null;
}

/**
 * Best-effort removal of the objects behind a clip (video + thumbnail).
 * Never throws: a failed cleanup must not block the row delete the user
 * actually asked for, or turn a failed upload into an error loop. Returns
 * how many paths were handed to Storage.
 */
export async function deleteClipAssets(
  urls: (string | null | undefined)[],
): Promise<number> {
  const paths = urls
    .map(clipPathFromPublicUrl)
    .filter((p): p is string => !!p);
  if (paths.length === 0) return 0;
  try {
    await supabase.storage.from('clips').remove(paths);
  } catch {
    // Swallowed deliberately — see doc comment.
  }
  return paths.length;
}
