import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { reportError } from './errorReporting';

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

/**
 * Subscribe to postgres_changes on a table.
 * Returns an unsubscribe function for useEffect cleanup.
 */
export function subscribeToTable(
  channelName: string,
  table: string,
  event: ChangeEvent,
  callback: (payload: RealtimePostgresChangesPayload<any>) => void,
  filter?: string,
): () => void {
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event,
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      },
      callback,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to presence on a channel.
 * Returns an unsubscribe function.
 *
 * v9.4.1 hotfix (2026-08-10, build 19 TestFlight):
 *   The prior implementation crashed the whole screen with
 *   "Something went wrong / cannot add presence callbacks after
 *   joining a channel" when a user tapped Join on a fan group.
 *
 *   Root cause: Supabase Realtime throws synchronously if
 *   `.on('presence', ...)` is called on a channel already in
 *   state='joined'. Two paths hit that state:
 *     1. `supabase.removeChannel()` is async on the underlying
 *        socket. `supabase.channel(name)` on a rapid remount
 *        returns the previous channel still tearing down.
 *     2. The #11 fix made the presence useEffect depend on
 *        [id, currentUserId, isMember, isOwner] so an isMember
 *        false->true flip re-runs the effect. The synchronous
 *        throw during .on('presence') unwinds React and hits
 *        the RootErrorBoundary.
 *
 *   Two-part defense:
 *   (a) Force-remove any lingering channel with the same topic
 *       before creating the new one -- kills the common race.
 *   (b) Wrap the .on/.subscribe chain in try/catch and return a
 *       no-op unsub if it still throws. Presence just won't
 *       track for that instance, but the app doesn't crash.
 */
export function subscribeToPresence(
  channelName: string,
  onSync: (presenceState: Record<string, any[]>) => void,
  trackPayload?: Record<string, any>,
): () => void {
  // (a) Force-cleanup any leftover channel with this topic. Supabase
  // topics are prefixed with 'realtime:'. Cleanup is fire-and-forget
  // -- the underlying socket unsubscribe completes before the new
  // channel finishes joining, and even if there's overlap the new
  // channel below has its callbacks registered PRE-subscribe, which
  // is the state Supabase requires for presence.
  try {
    const prior = supabase
      .getChannels()
      .find((c) => c.topic === `realtime:${channelName}`);
    if (prior) {
      supabase.removeChannel(prior);
    }
  } catch (e) {
    reportError(e, { source: 'realtime:presenceCleanupPrior', channelName });
  }

  const channel = supabase.channel(channelName);

  // (b) Belt-and-suspenders: if the .on/.subscribe chain throws
  // synchronously (race not cleaned up in time), catch it and drop
  // the channel silently. Better than an ErrorBoundary crash.
  try {
    channel
      .on('presence', { event: 'sync' }, () => {
        try {
          const state = channel.presenceState();
          onSync(state);
        } catch (e) {
          reportError(e, { source: 'realtime:presenceSync', channelName });
        }
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED' && trackPayload) {
          try {
            await channel.track(trackPayload);
          } catch (e) {
            reportError(e, {
              source: 'realtime:presenceTrack',
              channelName,
            });
          }
        }
      });
  } catch (e) {
    reportError(e, { source: 'realtime:presenceSubscribe', channelName });
    try {
      supabase.removeChannel(channel);
    } catch {
      /* swallow -- cleanup best-effort */
    }
    return () => {
      /* no-op: subscription failed to establish */
    };
  }

  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── Convenience Subscriptions ───────────────────────────────

/**
 * Subscribe to live game score updates.
 */
export function subscribeToGames(
  onUpdate: (game: any) => void,
): () => void {
  return subscribeToTable(
    'games-realtime',
    'games',
    'UPDATE',
    (payload) => onUpdate(payload.new),
  );
}

/**
 * Subscribe to watch party changes in a given city.
 * Uses a single channel with wildcard event to reduce connection count.
 */
export function subscribeToWatchParties(
  city: string,
  onInsert: (party: any) => void,
  onUpdate?: (party: any) => void,
): () => void {
  return subscribeToTable(
    `watch-parties-${city}`,
    'watch_parties',
    '*',
    (payload) => {
      if (payload.eventType === 'INSERT') {
        onInsert(payload.new);
      } else if (payload.eventType === 'UPDATE' && onUpdate) {
        onUpdate(payload.new);
      }
    },
    // v9.4.3 (mig 087): venue_city is the venue's own city now; the metro
    // anchor is what "parties near <city>" means.
    `venue_metro=ilike.${city}`,
  );
}

/**
 * Subscribe to clip changes (inserts and updates).
 * Uses a single channel with wildcard event to reduce connection count.
 */
export function subscribeToClips(
  onInsert: (clip: any) => void,
  onUpdate?: (clip: any) => void,
): () => void {
  return subscribeToTable(
    'clips-realtime',
    'media_clips',
    '*',
    (payload) => {
      if (payload.eventType === 'INSERT') {
        onInsert(payload.new);
      } else if (payload.eventType === 'UPDATE' && onUpdate) {
        onUpdate(payload.new);
      }
    },
  );
}

/**
 * Subscribe to RSVP count changes on a specific watch party.
 */
export function subscribeToRsvpCounts(
  partyId: string,
  onUpdate: (rsvp: any) => void,
): () => void {
  return subscribeToTable(
    `rsvp-${partyId}`,
    'watch_party_rsvps',
    '*',
    (payload) => onUpdate(payload.new),
    `watch_party_id=eq.${partyId}`,
  );
}

/**
 * Subscribe to new messages in a chat room.
 */
export function subscribeToMessages(
  chatRoomId: string,
  onInsert: (message: any) => void,
): () => void {
  return subscribeToTable(
    `room-messages-${chatRoomId}`,
    'messages',
    'INSERT',
    (payload) => onInsert(payload.new),
    `chat_room_id=eq.${chatRoomId}`,
  );
}

// ─── React Query bridges ─────────────────────────────────────

const GAMES_INVALIDATION_DEBOUNCE_MS = 500;

/**
 * useGamesRealtime — subscribes to UPDATE events on the games table and
 * invalidates the ['games'] React Query cache so Today's Games re-renders
 * within ~1s of a sync write. The live cron writes a burst of rows in a
 * tight loop (up to 17 MLB games during peak hours), so a 500ms debounce
 * coalesces the burst into a single invalidation — one refetch + one
 * render instead of one per row.
 *
 * No status filter: Realtime evaluates filters against the NEW row state
 * only, so a status transition 'in' → 'post' (game ending) would not match
 * `status=eq.in` and the LIVE badge would never come off. UPDATE volume on
 * games is small (~1 update/min/live game), so subscribing to all UPDATEs
 * is cheaper than the bug risk.
 *
 * Mount once at the root layout (mirrors useEntitlementsRealtime).
 */
export function useGamesRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = subscribeToGames(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['games'] });
        timer = null;
      }, GAMES_INVALIDATION_DEBOUNCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient]);
}
