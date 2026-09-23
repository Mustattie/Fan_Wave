import { SharedVideoSource } from '../lib/sharedVideoSource';

/** A player whose replaceAsync we resolve by hand, in any order. */
function fakePlayer() {
  const pending: Array<{ source: any; resolve: () => void; reject: (e: unknown) => void }> = [];
  const calls: any[] = [];
  return {
    calls,
    pending,
    replaceAsync: jest.fn((source: any) => {
      calls.push(source);
      return new Promise<void>((resolve, reject) => pending.push({ source, resolve, reject }));
    }),
    settle(index: number) {
      pending[index]!.resolve();
    },
    fail(index: number, error: unknown) {
      pending[index]!.reject(error);
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('SharedVideoSource', () => {
  it('loads a uri and reports it current', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const result = s.load('a.mp4');
    expect(s.pendingUri).toBe('a.mp4');
    p.settle(0);
    expect(await result).toEqual({ outcome: 'loaded' });
    expect(s.currentUri).toBe('a.mp4');
    expect(s.pendingUri).toBeNull();
  });

  it('dedupes a load of the uri already loaded without touching the player', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const first = s.load('a.mp4');
    p.settle(0);
    await first;
    expect(await s.load('a.mp4')).toEqual({ outcome: 'same' });
    expect(p.replaceAsync).toHaveBeenCalledTimes(1);
  });

  it('marks a slow load stale when a newer one was requested, even if it resolves first', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const loadA = s.load('a.mp4');
    const loadB = s.load('b.mp4');
    // A's native load finishes after B was requested but before B finishes.
    p.settle(0);
    expect(await loadA).toEqual({ outcome: 'stale' });
    expect(s.currentUri).toBeNull();
    p.settle(1);
    expect(await loadB).toEqual({ outcome: 'loaded' });
    expect(s.currentUri).toBe('b.mp4');
  });

  it('does not issue a second native load for a uri already in flight', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const first = s.load('a.mp4');
    const dup = s.load('a.mp4');
    expect(p.replaceAsync).toHaveBeenCalledTimes(1);
    expect(await dup).toEqual({ outcome: 'stale' });
    p.settle(0);
    expect(await first).toEqual({ outcome: 'loaded' });
  });

  it('reports an error for a failed load that is still current, and leaves the last good uri', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const ok = s.load('a.mp4');
    p.settle(0);
    await ok;
    const bad = s.load('b.mp4');
    p.fail(1, new Error('decode'));
    const result = await bad;
    expect(result.outcome).toBe('error');
    expect((result.error as Error).message).toBe('decode');
    expect(s.currentUri).toBe('a.mp4');
    expect(s.pendingUri).toBeNull();
  });

  it('reports a failed load as stale when it was superseded', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const a = s.load('a.mp4');
    const b = s.load('b.mp4');
    p.fail(0, new Error('decode'));
    expect(await a).toEqual({ outcome: 'stale' });
    p.settle(1);
    expect(await b).toEqual({ outcome: 'loaded' });
  });

  it('force reloads the same uri (Try again)', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const first = s.load('a.mp4');
    p.settle(0);
    await first;
    const again = s.load('a.mp4', { force: true });
    expect(p.replaceAsync).toHaveBeenCalledTimes(2);
    p.settle(1);
    expect(await again).toEqual({ outcome: 'loaded' });
  });

  it('invalidate() makes an in-flight load stale without touching the player', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const a = s.load('a.mp4');
    s.invalidate();
    p.settle(0);
    expect(await a).toEqual({ outcome: 'stale' });
    expect(p.replaceAsync).toHaveBeenCalledTimes(1);
    expect(s.currentUri).toBeNull();
  });

  it('release() clears the source and the next load of the same uri really loads', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const first = s.load('a.mp4');
    p.settle(0);
    await first;
    const rel = s.release();
    expect(p.calls[1]).toBeNull();
    p.settle(1);
    await rel;
    expect(s.currentUri).toBeNull();
    const again = s.load('a.mp4');
    expect(p.replaceAsync).toHaveBeenCalledTimes(3);
    p.settle(2);
    expect(await again).toEqual({ outcome: 'loaded' });
  });

  it('release() swallows a rejection from the player', async () => {
    const p = fakePlayer();
    const s = new SharedVideoSource(p);
    const rel = s.release();
    p.fail(0, new Error('torn down'));
    await expect(rel).resolves.toBeUndefined();
    await tick();
  });
});
