import { uploadAsync, FileSystemUploadType, getInfoAsync } from 'expo-file-system/legacy';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Single storage abstraction. Currently backed by Supabase Storage; the
// future Cloudinary migration (FW-E18) swaps the implementation here without
// touching call sites in create-clip / MomentsFeed / etc.
// ---------------------------------------------------------------------------

export type StorageProvider = 'supabase' | 'cloudinary';

export interface UploadOptions {
  contentType: string;
  subpath: string; // e.g. 'moments/<timestamp>.mp4' — folder/ prefix is auto-added below auth.uid()
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

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_DURATION_SEC = 30;

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const path = `${user.id}/${opts.subpath}`;
  const provider = getProvider();

  if (provider === 'cloudinary') {
    return uploadToCloudinary(uri, path, opts.contentType);
  }
  return uploadToSupabase(uri, path, opts.contentType);
}

async function uploadToSupabase(uri: string, path: string, contentType: string): Promise<UploadResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('Not signed in');
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;

  // Native binary upload via expo-file-system — avoids the broken
  // fetch(file://).blob() → storage.upload() path on Android RN which
  // surfaces as a generic "Network request failed".
  const result = await uploadAsync(
    `${supabaseUrl}/storage/v1/object/clips/${path}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
    },
  );
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
