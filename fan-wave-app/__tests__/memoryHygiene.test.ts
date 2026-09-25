/**
 * P3.6 (2026-09-25): pins the bounding and cleanup contracts the Android
 * memory review asked for. None of this is device verification; it stops
 * the code-side guarantees from silently regressing.
 */
import { createPosterCache } from '../lib/clipsFeed';
import { initVideoDiskCache, VIDEO_DISK_CACHE_BYTES } from '../lib/videoBuffer';

describe('createPosterCache (bounded session cache)', () => {
  it('never exceeds its cap and keeps the newest entry', () => {
    const cache = createPosterCache(500);
    for (let i = 0; i < 501; i++) cache.set(`u${i}`, { name: `n${i}` });
    expect(cache.size).toBeLessThanOrEqual(500);
    expect(cache.has('u500')).toBe(true);
  });

  it('counts recorded misses toward the bound', () => {
    const cache = createPosterCache(3);
    cache.set('a', {});
    cache.set('b', {});
    cache.set('c', {});
    cache.set('d', {});
    expect(cache.size).toBe(1);
    expect(cache.has('d')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
  });

  it('updating an existing key does not trigger the overflow clear', () => {
    const cache = createPosterCache(2);
    cache.set('a', {});
    cache.set('b', {});
    cache.set('a', { name: 'A' });
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toEqual({ name: 'A' });
  });
});

describe('initVideoDiskCache', () => {
  it('caps the expo-video disk cache at 256 MB', () => {
    const setSize = jest.fn(() => Promise.resolve());
    initVideoDiskCache(setSize);
    expect(setSize).toHaveBeenCalledTimes(1);
    expect(setSize).toHaveBeenCalledWith(VIDEO_DISK_CACHE_BYTES);
    expect(VIDEO_DISK_CACHE_BYTES).toBe(256 * 1024 * 1024);
  });

  it('is best-effort: a rejecting or throwing runtime does not surface', async () => {
    expect(() => initVideoDiskCache(() => Promise.reject(new Error('no cache')))).not.toThrow();
    expect(() =>
      initVideoDiskCache(() => {
        throw new Error('not implemented');
      }),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
