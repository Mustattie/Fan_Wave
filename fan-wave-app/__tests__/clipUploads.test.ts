import AsyncStorage from '@react-native-async-storage/async-storage';

const mockUploadClip = jest.fn();
const mockFileExists = jest.fn(async (_uri: string) => true);
const mockDeleteLocalFile = jest.fn(async (_uri: string | null | undefined) => {});
jest.mock('@/lib/storage', () => ({
  uploadClip: (...a: any[]) => mockUploadClip(...a),
  deleteClipAssets: jest.fn(async () => 0),
  fileExists: (uri: string) => mockFileExists(uri),
  deleteLocalFile: (uri: string | null | undefined) => mockDeleteLocalFile(uri),
}));

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackEvent: (...a: any[]) => mockTrackEvent(...a),
}));

const mockReportMessage = jest.fn();
jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  reportMessage: (...a: any[]) => mockReportMessage(...a),
  addBreadcrumb: jest.fn(),
}));

const mockSwitches: Record<string, boolean> = {};
jest.mock('@/lib/killSwitches', () => ({
  isFeatureEnabled: (key: string) => mockSwitches[key] !== false,
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

    it('drops a failed job older than 7 days and removes its local files (fix 6)', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const stale = job({
        tempId: 'stale',
        createdAt: eightDaysAgo,
        localUri: 'file:///old.mp4',
        localThumbnailUri: 'file:///old.thumb.jpg',
      });
      const fresh = job({ tempId: 'fresh' });
      (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
        key === 'clipUploads.pending.v2'
          ? JSON.stringify([
              { ...stale, status: 'failed', errorKind: 'client', error: 'x' },
              { ...fresh, status: 'failed', errorKind: 'client', error: 'y' },
            ])
          : null,
      );
      const rec = recorder();

      await initClipUploads('user-1');
      await flush();

      expect(rec.latest('stale')).toBeUndefined();
      expect(rec.latest('fresh')).toMatchObject({ status: 'failed', recovered: true });
      expect(mockDeleteLocalFile).toHaveBeenCalledWith('file:///old.mp4');
      expect(mockDeleteLocalFile).toHaveBeenCalledWith('file:///old.thumb.jpg');
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'clip_upload_recovered',
        'clips',
        expect.objectContaining({ expired: 1, restored_failed: 1 }),
      );
      rec.unsub();
    });

    it('deletes the local thumbnail after it is uploaded (fix 6)', async () => {
      mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/t.mp4', provider: 'supabase' });
      const j = job({ localThumbnailUri: 'file:///still.jpg' });
      enqueueClipUpload(j);
      await flush();
      await flush();
      expect(mockDeleteLocalFile).toHaveBeenCalledWith('file:///still.jpg');
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

// v9.5.23 (P3.5): duplicate and orphan paths.
describe('clipUploads: recovery guards (v9.5.23)', () => {
  const { deleteClipAssets } = jest.requireMock('@/lib/storage') as { deleteClipAssets: jest.Mock };

  function mockTable(handlers: { insert?: () => Promise<any>; selectByUrl?: () => Promise<any> }) {
    (supabase.from as jest.Mock).mockImplementation(() => {
      const chain: any = {};
      chain.insert = jest.fn(() => chain);
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.single = jest.fn(() => (handlers.insert ? handlers.insert() : Promise.resolve({ data: { id: 'row-1' }, error: null })));
      chain.maybeSingle = jest.fn(() => (handlers.selectByUrl ? handlers.selectByUrl() : Promise.resolve({ data: null, error: null })));
      return chain;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    _resetClipUploadsForTests();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockFileExists.mockResolvedValue(true);
  });

  it('ignores a retry while the job is still in flight (no second upload)', async () => {
    let release!: () => void;
    mockUploadClip.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ publicUrl: 'https://cdn/clips/u/1.mp4', provider: 'supabase' }); }),
    );
    mockTable({});
    const rec = recorder();
    const j = job();
    enqueueClipUpload(j);
    await flush();
    expect(rec.latest(j.tempId)!.status).toBe('uploading');

    retryClipUpload(j.tempId);
    retryClipUpload(j.tempId);
    await flush();
    expect(mockUploadClip).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).not.toHaveBeenCalledWith('clip_upload_retried', 'clips', expect.anything());

    release();
    await flush();
    await flush();
    expect(rec.latest(j.tempId)!.realId).toBe('row-1');
    rec.unsub();
  });

  it('treats an insert timeout as success when the row exists on the server, and never orphans the blob otherwise', async () => {
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/1.mp4', provider: 'supabase' });
    // First run: insert hangs past the timeout; the server does have the row.
    mockTable({
      insert: () => new Promise(() => {}),
      selectByUrl: () => Promise.resolve({ data: { id: 'row-committed' }, error: null }),
    });
    jest.useFakeTimers();
    const rec = recorder();
    const j = job();
    enqueueClipUpload(j);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(31_000);
    await jest.advanceTimersByTimeAsync(1);
    jest.useRealTimers();
    await flush();
    await flush();
    expect(rec.latest(j.tempId)!.realId).toBe('row-committed');
    expect(deleteClipAssets).not.toHaveBeenCalled();
    expect(mockUploadClip).toHaveBeenCalledTimes(1);

    // Second run: insert hangs and the row is NOT there -> blob removed, job failed.
    rec.unsub();
    _resetClipUploadsForTests();
    const rec2 = recorder();
    mockTable({
      insert: () => new Promise(() => {}),
      selectByUrl: () => Promise.resolve({ data: null, error: null }),
    });
    jest.useFakeTimers();
    const j2 = job();
    enqueueClipUpload(j2);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(31_000);
    await jest.advanceTimersByTimeAsync(1);
    jest.useRealTimers();
    await flush();
    await flush();
    expect(rec2.latest(j2.tempId)!.status).toBe('failed');
    expect(deleteClipAssets).toHaveBeenCalledWith(['https://cdn/clips/u/1.mp4', null]);
    rec2.unsub();
  });

  it('reconciles a restored job that had reached the insert instead of uploading again', async () => {
    const j = job({ tempId: 'restored' });
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'clipUploads.pending.v2'
        ? JSON.stringify([{ ...j, status: 'queued', mediaUrl: 'https://cdn/clips/u/old.mp4', thumbnailUrl: null }])
        : null,
    );
    mockTable({ selectByUrl: () => Promise.resolve({ data: { id: 'row-old' }, error: null }) });
    const rec = recorder();

    await initClipUploads('user-1');
    await flush();
    await flush();

    expect(mockUploadClip).not.toHaveBeenCalled();
    expect(rec.latest('restored')).toMatchObject({ realId: 'row-old', progress: 100 });
    expect(mockTrackEvent).toHaveBeenCalledWith('clip_upload_reconciled', 'clips', expect.objectContaining({ found: true }));
    rec.unsub();
  });
});

describe('clipUploads: clips_upload kill switch (P3.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetClipUploadsForTests();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockFileExists.mockResolvedValue(true);
    mockInsertSuccess();
    for (const k of Object.keys(mockSwitches)) delete mockSwitches[k];
  });

  it('parks a new upload as a retryable failure and runs it once the switch is back on', async () => {
    mockSwitches.clips_upload = false;
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/1.mp4', provider: 'supabase' });
    const rec = recorder();
    const j = job();
    enqueueClipUpload(j);
    await flush();
    expect(mockUploadClip).not.toHaveBeenCalled();
    expect(rec.latest(j.tempId)).toMatchObject({ status: 'failed', errorKind: 'paused' });
    expect(rec.latest(j.tempId)!.error).toMatch(/paused/);

    mockSwitches.clips_upload = true;
    retryClipUpload(j.tempId);
    await flush();
    await flush();
    expect(mockUploadClip).toHaveBeenCalledTimes(1);
    expect(rec.latest(j.tempId)!.realId).toBe('row-1');
    rec.unsub();
  });

  it('holds queued jobs while the switch is off', async () => {
    mockSwitches.clips_upload = true;
    let release!: () => void;
    mockUploadClip.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ publicUrl: 'https://cdn/clips/u/1.mp4', provider: 'supabase' }); }),
    );
    const rec = recorder();
    const a = job();
    enqueueClipUpload(a);
    await flush();
    // Switch flips while a is uploading; b is enqueued after the flip.
    mockSwitches.clips_upload = false;
    const b = job();
    enqueueClipUpload(b);
    await flush();
    expect(rec.latest(b.tempId)!.status).toBe('failed');
    release();
    await flush();
    await flush();
    // a finished normally; nothing else started.
    expect(rec.latest(a.tempId)!.realId).toBe('row-1');
    expect(mockUploadClip).toHaveBeenCalledTimes(1);
    rec.unsub();
  });
});

describe('clipUploads: Sentry events (P3.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetClipUploadsForTests();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockFileExists.mockResolvedValue(true);
    mockInsertSuccess();
    for (const k of Object.keys(mockSwitches)) delete mockSwitches[k];
  });

  it('reports clips.retry_exhausted on the third failed attempt only', async () => {
    mockUploadClip.mockRejectedValue(new Error('Upload failed (503): unavailable'));
    const rec = recorder();
    const j = job();
    enqueueClipUpload(j);
    await flush(); await flush();
    retryClipUpload(j.tempId);
    await flush(); await flush();
    expect(mockReportMessage).not.toHaveBeenCalledWith('clips.retry_exhausted', expect.anything(), expect.anything(), expect.anything());
    retryClipUpload(j.tempId);
    await flush(); await flush();
    expect(mockReportMessage).toHaveBeenCalledWith(
      'clips.retry_exhausted',
      'warning',
      expect.objectContaining({ attempt: 3, kind: 'server' }),
      { clip_error_kind: 'server' },
    );
    rec.unsub();
  });

  it('reports clips.upload_recovered when a restart resumes or restores jobs', async () => {
    const j = job({ tempId: 'resume-me' });
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) =>
      key === 'clipUploads.pending.v2' ? JSON.stringify([{ ...j, status: 'queued' }]) : null,
    );
    mockUploadClip.mockResolvedValue({ publicUrl: 'https://cdn/clips/u/1.mp4', provider: 'supabase' });
    await initClipUploads('user-1');
    await flush();
    expect(mockReportMessage).toHaveBeenCalledWith(
      'clips.upload_recovered',
      'info',
      expect.objectContaining({ found: 1, resumed: 1 }),
      { clips_recovery: 'resumed' },
    );
  });
});
