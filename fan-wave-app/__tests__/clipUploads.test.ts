import AsyncStorage from '@react-native-async-storage/async-storage';

const mockUploadClip = jest.fn();
const mockFileExists = jest.fn(async (_uri: string) => true);
jest.mock('@/lib/storage', () => ({
  uploadClip: (...a: any[]) => mockUploadClip(...a),
  deleteClipAssets: jest.fn(async () => 0),
  fileExists: (uri: string) => mockFileExists(uri),
}));

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackEvent: (...a: any[]) => mockTrackEvent(...a),
}));

jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  reportMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { supabase } from '../lib/supabase';
import {
  enqueueClipUpload,
  retryClipUpload,
  subscribeToClipUploads,
  initClipUploads,
  resumeAfterForeground,
  classifyUploadError,
  freshSubpath,
  _resetClipUploadsForTests,
  type JobState,
  type PendingClipJob,
} from '../lib/clipUploads';

function job(overrides: Partial<PendingClipJob> = {}): PendingClipJob {
  return {
    tempId: `temp-${Math.random().toString(36).slice(2)}`,
    localUri: 'file:///clip.mp4',
    contentType: 'video/mp4',
    subpath: '1000.mp4',
    title: 'Goal',
    description: '',
    sportId: 'mlb',
    momentType: null,
    durationSeconds: 12,
    userId: 'user-1',
    profileId: 'profile-1',
    displayName: 'Sam',
    createdAt: new Date().toISOString(),
    localThumbnailUri: null,
    ...overrides,
  };
}

/** Collect every emitted state, keyed by tempId, latest last. */
function recorder() {
  const states: JobState[] = [];
  const unsub = subscribeToClipUploads((s) => states.push(s));
  return {
    states,
    unsub,
    latest: (id: string) => [...states].reverse().find((s) => s.tempId === id),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function mockInsertSuccess() {
  (supabase.from as jest.Mock).mockReturnValue({
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { id: 'row-1' }, error: null })),
  });
}

describe('clipUploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetClipUploadsForTests();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockFileExists.mockResolvedValue(true);
    mockInsertSuccess();
  });

  it('freshSubpath keeps the extension and never returns the input', () => {
    const next = freshSubpath('1000.mov');
    expect(next).toMatch(/^\d+\.mov$/);
    expect(next).not.toBe('1000.mov');
  });

  it('classifies failures', () => {
    expect(classifyUploadError(new Error('Timeout after 90000ms'))).toBe('timeout');
    expect(classifyUploadError(new Error('Upload timed out. Check your connection'))).toBe('timeout');
    expect(classifyUploadError(new Error('Upload failed (409): Duplicate'))).toBe('client');
    expect(classifyUploadError(new Error('Upload failed (401): jwt expired'))).toBe('auth');
    expect(classifyUploadError(new Error('Upload failed (503): unavailable'))).toBe('server');
    expect(classifyUploadError(new Error('Network request failed'))).toBe('network');
    expect(classifyUploadError(new Error('Not signed in'))).toBe('auth');
    expect(classifyUploadError(new Error('weird'))).toBe('unknown');
  });

  it('runs a job to success and emits lifecycle telemetry', async () => {
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/1000.mp4', provider: 'supabase' });
    const rec = recorder();
    const j = job();
    enqueueClipUpload(j);
    await flush();
    await flush();

    const last = rec.latest(j.tempId)!;
    expect(last.realId).toBe('row-1');
    expect(last.progress).toBe(100);
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_started', 'clips', expect.objectContaining({ attempt: 1 }));
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_succeeded', 'clips', expect.objectContaining({ attempt: 1 }));
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_uploaded', 'clips', expect.anything());
    rec.unsub();
  });

  it('retries under a fresh subpath after a timeout', async () => {
    mockUploadClip.mockRejectedValueOnce(new Error('Upload timed out. Check your connection and try again.'));
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/2000.mp4', provider: 'supabase' });
    const rec = recorder();
    const j = job({ subpath: '1000.mp4' });
    enqueueClipUpload(j);
    await flush();
    await flush();

    let last = rec.latest(j.tempId)!;
    expect(last.status).toBe('failed');
    expect(last.errorKind).toBe('timeout');
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_failed', 'clips', expect.objectContaining({ error_kind: 'timeout', attempt: 1 }));

    retryClipUpload(j.tempId);
    await flush();
    await flush();

    const secondCall = mockUploadClip.mock.calls[1]!;
    expect(secondCall[1].subpath).not.toBe('1000.mp4');
    expect(secondCall[1].subpath).toMatch(/\.mp4$/);
    last = rec.latest(j.tempId)!;
    expect(last.realId).toBe('row-1');
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_retried', 'clips', expect.objectContaining({ source: 'manual' }));
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_succeeded', 'clips', expect.objectContaining({ attempt: 2 }));
    rec.unsub();
  });

  it('auto-retries a transient failure once on foreground, not a permanent one', async () => {
    mockUploadClip.mockRejectedValue(new Error('Network request failed'));
    const rec = recorder();
    const transient = job();
    enqueueClipUpload(transient);
    await flush();
    await flush();
    expect(rec.latest(transient.tempId)!.status).toBe('failed');

    mockUploadClip.mockRejectedValue(new Error('Upload failed (413): too large'));
    const permanent = job();
    enqueueClipUpload(permanent);
    await flush();
    await flush();
    expect(rec.latest(permanent.tempId)!.errorKind).toBe('client');

    mockUploadClip.mockClear();
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/3.mp4', provider: 'supabase' });
    resumeAfterForeground();
    await flush();
    await flush();

    expect(mockUploadClip).toHaveBeenCalledTimes(1);
    expect(rec.latest(transient.tempId)!.realId).toBe('row-1');
    expect(rec.latest(permanent.tempId)!.status).toBe('failed');
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_retried', 'clips', expect.objectContaining({ source: 'auto' }));

    // Second foreground does not retry again.
    mockUploadClip.mockClear();
    mockUploadClip.mockRejectedValue(new Error('Network request failed'));
    resumeAfterForeground();
    await flush();
    expect(mockUploadClip).not.toHaveBeenCalled();
    rec.unsub();
  });

  it('persists failed jobs so a restart does not lose them', async () => {
    mockUploadClip.mockRejectedValue(new Error('Upload timed out. x'));
    const j = job();
    enqueueClipUpload(j);
    await flush();
    await flush();
    const writes = (AsyncStorage.setItem as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'clipUploads.pending.v2',
    );
    const lastWrite = JSON.parse(writes[writes.length - 1]![1]);
    expect(lastWrite).toHaveLength(1);
    expect(lastWrite[0]).toMatchObject({ tempId: j.tempId, status: 'failed', errorKind: 'timeout' });
  });

  describe('initClipUploads (recovery after restart)', () => {
    it('resumes queued jobs under a fresh path, restores failed ones, and drops other users', async () => {
      const queued = job({ tempId: 'q1', subpath: '1000.mp4' });
      const failed = job({ tempId: 'f1' });
      const other = job({ tempId: 'o1', userId: 'someone-else' });
      (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
        key === 'clipUploads.pending.v2'
          ? JSON.stringify([
              { ...queued, status: 'queued', attempt: 1 },
              { ...failed, status: 'failed', error: 'old error', errorKind: 'client' },
              { ...other, status: 'queued' },
            ])
          : null,
      );
      mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/9.mp4', provider: 'supabase' });
      const rec = recorder();

      await initClipUploads('user-1');
      await flush();
      await flush();

      expect(mockUploadClip).toHaveBeenCalledTimes(1);
      expect(mockUploadClip.mock.calls[0]![1].subpath).not.toBe('1000.mp4');
      expect(rec.latest('q1')!.realId).toBe('row-1');
      expect(rec.latest('q1')!.recovered).toBe(true);
      expect(rec.latest('f1')).toMatchObject({ status: 'failed', error: 'old error', recovered: true });
      expect(rec.latest('o1')).toBeUndefined();
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'clip_upload_recovered',
        'clips',
        expect.objectContaining({ found: 3, resumed: 1, restored_failed: 1, dropped: 1 }),
      );
      rec.unsub();
    });

    it('fails a job whose local file is gone with a message that says so', async () => {
      const j = job({ tempId: 'gone' });
      (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
        key === 'clipUploads.pending.v2' ? JSON.stringify([{ ...j, status: 'queued' }]) : null,
      );
      mockFileExists.mockResolvedValue(false);
      const rec = recorder();

      await initClipUploads('user-1');
      await flush();

      expect(mockUploadClip).not.toHaveBeenCalled();
      expect(rec.latest('gone')).toMatchObject({ status: 'failed', errorKind: 'file_missing' });
      expect(rec.latest('gone')!.error).toMatch(/no longer on this device/);
      rec.unsub();
    });

    it('reads the legacy v1 key once and clears it', async () => {
      const j = job({ tempId: 'legacy' });
      (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
        key === 'clipUploads.pending.v1' ? JSON.stringify([j]) : null,
      );
      mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/l.mp4', provider: 'supabase' });
      const rec = recorder();

      await initClipUploads('user-1');
      await flush();
      await flush();

      expect(rec.latest('legacy')!.realId).toBe('row-1');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('clipUploads.pending.v1');
      rec.unsub();
    });

    it('is a no-op when called twice for the same user', async () => {
      await initClipUploads('user-1');
      await initClipUploads('user-1');
      expect(
        (AsyncStorage.getItem as jest.Mock).mock.calls.filter((c) => c[0] === 'clipUploads.pending.v2'),
      ).toHaveLength(1);
    });
  });
});
