import {
  liveClipIds,
  hydrationKey,
  mergeClipPage,
  replaceClipPage,
  applyClipUpdate,
  prependRealtimeClip,
} from '../lib/clipsFeed';
import type { ClipDisplay } from '../lib/mappers';

function clip(id: string, extra: Partial<ClipDisplay> = {}): ClipDisplay {
  return {
    id,
    title: `t-${id}`,
    poster: '@someone',
    group: 'g',
    time: 'now',
    sport: 'nba',
    sportIcon: '',
    likes: 0,
    like_count: 0,
    view_count: 0,
    comments: 0,
    comment_count: 0,
    shares: 0,
    bgColors: [],
    videoUrl: `https://x/${id}.mp4`,
    thumbnailUrl: null,
    userId: `u-${id}`,
    mediaType: 'video',
    ...extra,
  } as ClipDisplay;
}

describe('clipsFeed (v9.5.22: hydration chatter + pagination)', () => {
  it('keeps retryable and in-flight uploads when a refreshed feed is empty', () => {
    const failed = clip('temp-failed', { status: 'failed', uploadError: 'Uploads paused' });
    const uploading = clip('temp-uploading', { status: 'uploading', progress: 43 });
    expect(replaceClipPage([failed, clip('old'), uploading], [], 200))
      .toEqual([failed, uploading]);
  });

  it('replaces old server rows while keeping current upload state and bounding the page', () => {
    const pending = clip('temp-1', { status: 'failed', progress: 80 });
    expect(replaceClipPage([clip('old'), pending], [clip('new'), clip('new'), clip('next')], 2))
      .toEqual([pending, clip('new')]);
    expect(replaceClipPage([clip('completed', { status: 'live' })], [], 200)).toEqual([]);
  });

  it('liveClipIds skips upload placeholders and failed cards', () => {
    const list = [
      clip('a'),
      clip('temp-1', { status: 'uploading', tempId: 'temp-1' }),
      clip('temp-2', { status: 'failed', tempId: 'temp-2' }),
      clip('b', { status: 'live' }),
    ];
    expect(liveClipIds(list)).toEqual(['a', 'b']);
  });

  it('hydrationKey is unchanged by counter, progress and like updates', () => {
    const base = [clip('a'), clip('b')];
    const k0 = hydrationKey(base);
    const bumped = base.map((c) => (c.id === 'a' ? { ...c, like_count: 9, likes: 9 } : c));
    expect(hydrationKey(bumped)).toBe(k0);
    const withProgress = [
      clip('temp-1', { status: 'uploading', tempId: 'temp-1', progress: 40 }),
      ...base,
    ];
    const withMoreProgress = [{ ...withProgress[0]!, progress: 80 }, ...base];
    expect(hydrationKey(withProgress)).toBe(k0);
    expect(hydrationKey(withMoreProgress)).toBe(k0);
    // A new live clip does change it.
    expect(hydrationKey([clip('c'), ...base])).not.toBe(k0);
  });

  it('mergeClipPage drops rows already on the list and keeps the cap', () => {
    const prev = [clip('a'), clip('b')];
    // Offset drift: the next page repeats 'b'.
    const next = mergeClipPage(prev, [clip('b'), clip('c'), clip('d')], 3);
    expect(next.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // Nothing new: same reference, no re-render.
    expect(mergeClipPage(prev, [clip('a')], 10)).toBe(prev);
  });

  it('applyClipUpdate merges counters and keeps the hydrated poster', () => {
    const existing = clip('a', { poster: '@real_name', posterTier: 'mvp', like_count: 1, likes: 1 });
    const updated = applyClipUpdate(existing, { id: 'a', like_count: 2, view_count: 10, user_id: 'u-a' });
    expect(updated.poster).toBe('@real_name');
    expect(updated.posterTier).toBe('mvp');
    expect(updated.likes).toBe(2);
    expect(updated.like_count).toBe(2);
    expect(updated.view_count).toBe(10);
    // Identical counters: same reference.
    expect(applyClipUpdate(updated, { id: 'a', like_count: 2, view_count: 10 })).toBe(updated);
  });

  it('prependRealtimeClip dedupes by id and by pending upload url', () => {
    const pending = clip('temp-1', {
      status: 'uploading',
      tempId: 'temp-1',
      pendingMediaUrl: 'https://x/mine.mp4',
    });
    const prev = [pending, clip('a')];
    expect(prependRealtimeClip(prev, clip('a'), 'https://x/a.mp4', 200)).toBe(prev);
    expect(prependRealtimeClip(prev, clip('server-1'), 'https://x/mine.mp4', 200)).toBe(prev);
    const next = prependRealtimeClip(prev, clip('b'), 'https://x/b.mp4', 2);
    expect(next.map((c) => c.id)).toEqual(['b', 'temp-1']);
  });
});
