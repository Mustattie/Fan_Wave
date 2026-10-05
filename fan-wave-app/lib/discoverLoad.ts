// Discover tab loading: bounded waits, previous data kept on failure.
//
// Build 33 UAT (2026-10-03, emulator, R6 airplane cycles): after repeated
// reconnects Discover showed only its header, search box, sport chips and
// a spinner. Two pull-to-refresh attempts and two tab round-trips left it
// that way; only a force-stop relaunch brought the Fan Groups / Watch
// Parties sections back. The screen's loadData awaited two Supabase
// queries with no timeout; a request that never settled after the socket
// dropped kept `loading` true, and the loading branch replaced the whole
// list -- RefreshControl included -- with a full-screen ActivityIndicator,
// so there was no recovery path short of restarting the process.
//
// Two rules fix that: every load settles within DISCOVER_LOAD_TIMEOUT_MS,
// and a failed or timed-out load keeps whatever the screen already had.

import { withTimeout } from '@/lib/withTimeout';

export const DISCOVER_LOAD_TIMEOUT_MS = 15_000;

/**
 * Run `thunk` with a timeout. Resolves to its value, or to `null` when it
 * rejects or times out -- after reporting through `onError`. Never throws,
 * so callers can `Promise.all` several of these and keep the previous
 * state for any that returned null.
 */
export async function loadOrKeep<T>(
  thunk: () => PromiseLike<T>,
  onError: (e: unknown) => void,
  ms: number = DISCOVER_LOAD_TIMEOUT_MS,
): Promise<T | null> {
  try {
    return await withTimeout(thunk, ms);
  } catch (e) {
    try {
      onError(e);
    } catch {
      /* reporting must never break the load */
    }
    return null;
  }
}

/**
 * Whether the full-screen spinner may replace the list. Only before the
 * first load has settled: after that the list (and its RefreshControl)
 * stays mounted and refetches show the section-level indicators instead.
 */
export function showFullScreenLoader(loading: boolean, refreshing: boolean, loadedOnce: boolean): boolean {
  return loading && !refreshing && !loadedOnce;
}

/**
 * Guard for stale requests: returns true if this request is still current
 * and the component is mounted. Prevents race conditions where old requests
 * apply their results after a newer request has already succeeded.
 */
export function isActiveDiscoverRequest(
  requestId: number,
  currentId: number,
  mounted: boolean,
): boolean {
  return requestId === currentId && mounted;
}
