// Pure list helpers for the Clips feed (app/(tabs)/clips.tsx).
//
// v9.5.22 (P2.5 / P2.6): the feed's like/follow hydration effect was keyed
// on the `clips` array reference, so every setClips -- a like tap, every
// upload progress tick, every realtime counter bump from any user -- re-ran
// two batch queries over the whole list. Pagination appended without an id
// check, so a realtime insert shifting offsets produced duplicate keys. The
// helpers here make those decisions explicit and testable.

import type { ClipDisplay } from '@/lib/mappers';

/** Ids of clips that exist on the server: optimistic placeholders excluded. */
export function liveClipIds(clips: ReadonlyArray<ClipDisplay>): string[] {
  const out: string[] = [];
  for (const c of clips) {
    if (c.status === 'uploading' || c.status === 'failed') continue;
    if (!c.id || c.id.startsWith('temp-')) continue;
    out.push(c.id);
  }
  return out;
}

/**
 * Stable key for "which clips need like/follow hydration". Changes only
 * when the set of live clips (or their posters) changes -- a page load, a
 * realtime insert, an upload swapping to its real row -- never on counter
 * or progress updates.
 */
export function hydrationKey(clips: ReadonlyArray<ClipDisplay>): string {
  const ids = liveClipIds(clips);
  const posters = new Set<string>();
  for (const c of clips) {
    if (c.userId && !(c.status === 'uploading' || c.status === 'failed')) posters.add(c.userId);
  }
  return `${ids.join(',')}|${Array.from(posters).join(',')}`;
}

/** Append a page, dropping rows already on the list, bounded by `cap`. */
export function mergeClipPage(
  prev: ReadonlyArray<ClipDisplay>,
  page: ReadonlyArray<ClipDisplay>,
  cap: number,
): ClipDisplay[] {
  const seen = new Set(prev.map((c) => c.id));
  const fresh = page.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  if (fresh.length === 0) return prev as ClipDisplay[];
  return [...prev, ...fresh].slice(0, cap);
}

/**
 * Apply a realtime UPDATE to the card it belongs to. Only the counters
 * move; poster name/tier (hydrated from get_public_profiles) and any
 * optimistic upload state stay. Replacing the card wholesale reverted the
 * poster to '@unknown' on every like anyone made.
 */
export function applyClipUpdate(existing: ClipDisplay, row: any): ClipDisplay {
  const likeCount = typeof row.like_count === 'number' ? row.like_count : existing.like_count;
  const viewCount = typeof row.view_count === 'number' ? row.view_count : existing.view_count;
  const commentCount =
    typeof row.comment_count === 'number' ? row.comment_count : existing.comment_count;
  const shareCount = typeof row.share_count === 'number' ? row.share_count : existing.shares;
  if (
    likeCount === existing.like_count &&
    viewCount === existing.view_count &&
    commentCount === existing.comment_count &&
    shareCount === existing.shares &&
    (row.title === undefined || row.title === existing.title)
  ) {
    return existing;
  }
  return {
    ...existing,
    ...(typeof row.title === 'string' ? { title: row.title } : {}),
    likes: likeCount,
    like_count: likeCount,
    view_count: viewCount,
    comments: commentCount,
    comment_count: commentCount,
    shares: shareCount,
  };
}

/**
 * Prepend a realtime INSERT unless it is already on the list or is the
 * server row of an upload placeholder still awaiting its swap.
 */
export function prependRealtimeClip(
  prev: ReadonlyArray<ClipDisplay>,
  clip: ClipDisplay,
  mediaUrl: string | null | undefined,
  cap: number,
): ClipDisplay[] {
  if (prev.some((c) => c.id === clip.id)) return prev as ClipDisplay[];
  if (
    mediaUrl &&
    prev.some((c) => c.status === 'uploading' && !!c.pendingMediaUrl && c.pendingMediaUrl === mediaUrl)
  ) {
    return prev as ClipDisplay[];
  }
  return [clip, ...prev].slice(0, cap);
}
