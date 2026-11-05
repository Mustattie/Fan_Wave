/**
 * Chat author hydration.
 *
 * 2026-11-05, found while capturing Android store screenshots on native
 * build 37: every incoming message in a fan-group chat rendered its
 * sender as "Unknown".
 *
 * Cause: `app/fan-group/[id].tsx` reads raw `messages` rows on the
 * initial load, the catch-up fetch and the realtime handler, then hands
 * them to `mapMessageToDisplay`, which looks for `row.user.display_name`
 * or `row.user_name`. Neither exists on a raw row, so the mapper took
 * its 'Unknown' fallback. Only the pagination path resolved a name, and
 * it did so with a `users!user_id(*)` join -- a different shape from
 * every other path, and one that selects whole user rows (email
 * included) rather than the public projection.
 *
 * Fix: resolve names through `get_public_profiles(p_user_ids)`, the
 * SECURITY DEFINER batch accessor (mig 086/089) that the Clips feed and
 * the comments sheet already use. It returns `{ user_id, display_name }`
 * keyed by the auth UUID -- the same value `messages.user_id` holds --
 * and exposes no email. No RLS change, no new table access.
 *
 * Properties this module guarantees, because chat is a live surface:
 *   - batched: one RPC per distinct set of unknown ids, never per row;
 *   - bounded: an LRU-ish cap on the cache and a timeout on the call;
 *   - non-throwing: a failed or slow lookup resolves to "no names
 *     learned", so callers keep whatever text they already had rather
 *     than dropping or blocking a message.
 */
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/withTimeout';
import { addBreadcrumb } from '@/lib/errorReporting';

/**
 * Chat is latency-sensitive, so this is tighter than the 8s composer
 * budget in the screen: a name is cosmetic, and waiting longer than this
 * to learn one is worse than showing the fallback and moving on.
 */
export const AUTHOR_LOOKUP_TIMEOUT_MS = 6_000;

/**
 * Names are small and change rarely. The cap keeps a long-lived session
 * in a busy room from growing the map without bound; eviction is
 * insertion-order (oldest first), which for chat authors is close enough
 * to least-recently-seen.
 */
const MAX_CACHED_AUTHORS = 500;

const authorNameCache = new Map<string, string>();

function remember(userId: string, displayName: string): void {
  if (!userId || !displayName) return;
  // Re-insert so refreshed entries move to the back of the eviction order.
  if (authorNameCache.has(userId)) authorNameCache.delete(userId);
  authorNameCache.set(userId, displayName);
  while (authorNameCache.size > MAX_CACHED_AUTHORS) {
    const oldest = authorNameCache.keys().next();
    if (oldest.done) break;
    authorNameCache.delete(oldest.value);
  }
}

/** Distinct, truthy user ids, in first-seen order. */
export function collectAuthorIds(rows: Array<{ user_id?: string | null } | null | undefined>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows ?? []) {
    const id = row?.user_id;
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Resolve display names for the given auth user ids.
 *
 * Returns only what it actually knows: ids with no profile, or every id
 * if the lookup fails, are simply absent from the map. Never rejects --
 * callers treat a miss as "leave the existing text alone".
 */
export async function fetchAuthorNames(userIds: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const id of new Set(userIds ?? [])) {
    if (!id) continue;
    const cached = authorNameCache.get(id);
    if (cached) resolved.set(id, cached);
    else missing.push(id);
  }

  if (missing.length === 0) return resolved;

  try {
    const { data, error } = await withTimeout(
      () => supabase.rpc('get_public_profiles', { p_user_ids: missing }),
      AUTHOR_LOOKUP_TIMEOUT_MS,
    );
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ user_id?: string | null; display_name?: string | null }>) {
      const id = row?.user_id;
      const name = row?.display_name;
      if (typeof id === 'string' && id && typeof name === 'string' && name) {
        remember(id, name);
        resolved.set(id, name);
      }
    }
  } catch (e) {
    // Deliberately not reportError: a name lookup failing during an
    // outage is the outage, and chat already reports the message fetch
    // that failed alongside it. A breadcrumb keeps the trail.
    addBreadcrumb('chat', 'author_hydration.failed', {
      count: missing.length,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  return resolved;
}

/**
 * Stamp `user_name` onto raw rows so `mapMessageToDisplay` /
 * `mapMomentToMessageDisplay` find it where they already look.
 *
 * Rows whose author did not resolve are returned untouched, so the
 * mappers keep their own fallbacks ('Unknown' for messages, 'Member' for
 * moments) rather than being handed an empty string.
 */
export function applyAuthorNames<T extends { user_id?: string | null }>(
  rows: T[],
  names: Map<string, string>,
): T[] {
  if (names.size === 0) return rows;
  return (rows ?? []).map((row) => {
    const id = row?.user_id;
    const name = id ? names.get(id) : undefined;
    return name ? { ...row, user_name: name } : row;
  });
}

/** Fetch and stamp in one step -- the shape every batch call site wants. */
export async function hydrateAuthorNames<T extends { user_id?: string | null }>(
  rows: T[],
): Promise<T[]> {
  if (!rows?.length) return rows ?? [];
  const names = await fetchAuthorNames(collectAuthorIds(rows));
  return applyAuthorNames(rows, names);
}

/** Test seam. Not used by app code. */
export function __resetAuthorNameCache(): void {
  authorNameCache.clear();
}

/** Test seam. Not used by app code. */
export function __authorNameCacheSize(): number {
  return authorNameCache.size;
}
