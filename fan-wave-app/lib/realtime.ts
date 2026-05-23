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
 */
export function subscribeToPresence(
  channelName: string,
  onSync: (presenceState: Record<string, any[]>) => void,
  trackPayload?: Record<string, any>,
): () => void {
  const channel = supabase.channel(channelName);

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
          reportError(e, { source: 'realtime:presenceTrack', channelName });
        }
      }
    });

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
    `venue_city=ilike.${city}`,
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
