import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { isFeatureEnabled, useKillSwitch } from './killSwitches';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { addBreadcrumb, reportError, reportMessage } from './errorReporting';

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';
type Handler = (payload: RealtimePostgresChangesPayload<any>) => void;

export interface SubscribeOptions {
  /**
   * Called after the channel re-joins following an error, timeout, socket
   * drop or unexpected close. Realtime does not replay what was missed
   * while the channel was down; this is the hook for a consumer to go and
   * fetch it (chat catches up on messages, games invalidates its query).
   */
  onReconnect?: () => void;
}

// ---------------------------------------------------------------------------
// Reference-counted channel registry.
//
// Phase 1 (2026-09-16 scalability review). The old subscribeToTable did
//
//     supabase.channel(name).on(...).subscribe()
//     return () => supabase.removeChannel(channel)
//
// which looks like it gives every caller its own channel. It does not.
// realtime-js RealtimeClient.channel(topic) returns the EXISTING channel
// when one with that topic is already open, and RealtimeChannel.subscribe()
// is a no-op once the channel has joined. So the root layout's
// session-long `games-realtime` subscription, Home's, Game Day's and the
// game-detail screen's all shared ONE channel object -- and whichever of
// them unmounted first called removeChannel() on it, killing live scores
// for everyone else, silently, because nothing passed a status callback.
//
// Now a topic is opened once, every subscriber's handler is fanned out
// from a single binding, and the channel is only removed when the last
// subscriber leaves (after a short grace so a tab switch that unmounts
// one screen and mounts the next does not churn the socket). Every
// channel has a status callback; errors are reported, unexpected closes
// are re-opened with backoff, and re-joins notify subscribers so they can
// catch up.
// ---------------------------------------------------------------------------

interface Subscriber {
  handler: Handler;
  onReconnect?: () => void;
}

type EntryStatus = 'pending' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

interface Entry {
  key: string;
  table: string;
  event: ChangeEvent;
  filter?: string;
  signature: string;
  channel: RealtimeChannel | null;
  subscribers: Set<Subscriber>;
  status: EntryStatus;
  subscribedOnce: boolean;
  /** True while WE are removing the channel, so its CLOSED is expected. */
  closing: boolean;
  teardownTimer: ReturnType<typeof setTimeout> | null;
  reopenTimer: ReturnType<typeof setTimeout> | null;
  /** Armed on a post-join error; fires if no SUBSCRIBED follows in time. */
  rejoinWatchdog: ReturnType<typeof setTimeout> | null;
  /** P3.6: the 0-3 s onReconnect spread timers, cleared with the entry. */
  reconnectTimers: Set<ReturnType<typeof setTimeout>>;
  reopenAttempts: number;
  errors: number;
  rejoins: number;
  lastReportAt: Record<string, number>;
}

const registry = new Map<string, Entry>();

// A tab switch unmounts one screen's effect and mounts the next's within
// the same frame. Holding the channel briefly turns that into a no-op
// instead of a leave + re-join on the socket.
const TEARDOWN_GRACE_MS = 300;
// One warning per topic per kind per minute. A flapping socket would
// otherwise flood Sentry.
const REPORT_DEDUPE_MS = 60_000;
const REOPEN_BASE_MS = 2_000;
const REOPEN_MAX_ATTEMPTS = 5;
// P2.3 (2026-09-25): after a shared outage every device re-joins and
// refetches on the same schedule. Re-opens are spread over [delay, 1.5x
// delay) and the per-subscriber onReconnect work (games invalidation, chat
// catch-up, entitlements) over [0, RECONNECT_SPREAD_MS) so a stadium's
// worth of phones does not hit PostgREST in the same second.
const RECONNECT_SPREAD_MS = 3_000;

/** [ms, 1.5 * ms). Exposed for tests. */
export function jitter(ms: number, random: () => number = Math.random): number {
  return Math.floor(ms + random() * ms * 0.5);
}
// Build 28 UAT (2026-09-24): a dropped WebSocket makes Phoenix fire the
// error event on EVERY joined channel (Socket.onConnClose ->
// triggerChanError), which realtime-js surfaces as CHANNEL_ERROR -- the
// same status a rejected join produces. Reporting both as
// `realtime.channel_error` filled Sentry with reconnect noise carrying no
// topic and hid the one case that matters. A post-join error is now only
// a breadcrumb unless the channel has not re-subscribed within this
// window; a pre-join error is reported at once as a rejected join.
const REJOIN_WATCHDOG_MS = 60_000;

function socketConnected(): boolean {
  try {
    return supabase.realtime.isConnected();
  } catch {
    return false;
  }
}

function signatureOf(table: string, event: ChangeEvent, filter?: string): string {
  return `${table}|${event}|${filter ?? ''}`;
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function reportOnce(entry: Entry, kind: string, detail?: string, level: 'warning' | 'error' = 'warning'): void {
  const now = Date.now();
  const last = entry.lastReportAt[kind] ?? 0;
  if (now - last < REPORT_DEDUPE_MS) return;
  entry.lastReportAt[kind] = now;
  // Topic in the title so Sentry groups one issue per channel and the
  // list view says which one; also a tag so it is filterable.
  reportMessage(
    `realtime.${kind} [${entry.key}]`,
    level,
    {
      topic: entry.key,
      table: entry.table,
      event: entry.event,
      filter: entry.filter ?? null,
      phase: entry.subscribedOnce ? 'after-join' : 'initial-join',
      socketConnected: socketConnected(),
      subscribers: entry.subscribers.size,
      errors: entry.errors,
      rejoins: entry.rejoins,
      detail: detail ?? null,
    },
    { realtime_topic: entry.key, realtime_table: entry.table },
  );
}

function clearRejoinWatchdog(entry: Entry): void {
  if (entry.rejoinWatchdog) {
    clearTimeout(entry.rejoinWatchdog);
    entry.rejoinWatchdog = null;
  }
}

function fanout(entry: Entry, payload: RealtimePostgresChangesPayload<any>): void {
  for (const sub of entry.subscribers) {
    try {
      sub.handler(payload);
    } catch (e) {
      reportError(e, { source: 'realtime:handler', topic: entry.key });
    }
  }
}

function notifyReconnect(entry: Entry): void {
  for (const sub of entry.subscribers) {
    if (!sub.onReconnect) continue;
    const cb = sub.onReconnect;
    const timer = setTimeout(() => {
      entry.reconnectTimers.delete(timer);
      // The subscriber may have left during the spread window.
      if (!entry.subscribers.has(sub)) return;
      try {
        cb();
      } catch (e) {
        reportError(e, { source: 'realtime:onReconnect', topic: entry.key });
      }
    }, Math.floor(Math.random() * RECONNECT_SPREAD_MS));
    entry.reconnectTimers.add(timer);
  }
}

function clearReconnectTimers(entry: Entry): void {
  for (const t of entry.reconnectTimers) clearTimeout(t);
  entry.reconnectTimers.clear();
}

function onStatus(entry: Entry, channel: RealtimeChannel, status: string, err?: Error): void {
  // A status from a channel we have already replaced (see scheduleReopen)
  // is history, not news.
  if (entry.channel !== channel) return;

  switch (status) {
    case 'SUBSCRIBED': {
      entry.status = 'SUBSCRIBED';
      entry.reopenAttempts = 0;
      clearRejoinWatchdog(entry);
      if (entry.subscribedOnce) {
        entry.rejoins += 1;
        addBreadcrumb('realtime', 'rejoined', { topic: entry.key, rejoins: entry.rejoins });
        notifyReconnect(entry);
      } else {
        entry.subscribedOnce = true;
        addBreadcrumb('realtime', 'joined', { topic: entry.key });
      }
      return;
    }
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT': {
      // realtime-js schedules its own re-join for both of these; we only
      // need to make the failure visible -- and to say which kind it is.
      entry.status = status;
      entry.errors += 1;
      if (!entry.subscribedOnce) {
        // Never joined: the server refused it (unsupported filter,
        // unpublished table, RLS) or the join timed out. This is the case
        // worth a warning every time, and it names the topic.
        reportOnce(entry, 'join_rejected', `${status}: ${err?.message ?? 'no detail'}`);
        return;
      }
      // Already joined once: this is almost always the socket dropping
      // (background, network change) and Phoenix erroring every channel on
      // the way down. It will rejoin when the socket returns. Breadcrumb
      // now; warn only if the rejoin does not happen.
      addBreadcrumb('realtime', 'channel_error.after_join', {
        topic: entry.key,
        status,
        socketConnected: socketConnected(),
        detail: err?.message ?? null,
      });
      if (!entry.rejoinWatchdog) {
        entry.rejoinWatchdog = setTimeout(() => {
          entry.rejoinWatchdog = null;
          if (!registry.has(entry.key) || entry.status === 'SUBSCRIBED') return;
          reportOnce(entry, 'rejoin_failed', `still ${entry.status} after ${REJOIN_WATCHDOG_MS / 1000}s`);
        }, REJOIN_WATCHDOG_MS);
      }
      return;
    }
    case 'CLOSED': {
      if (entry.closing || !registry.has(entry.key)) return; // ours
      entry.status = 'CLOSED';
      entry.errors += 1;
      reportOnce(entry, 'closed_unexpectedly');
      scheduleReopen(entry);
      return;
    }
    default:
      return;
  }
}

function openChannel(entry: Entry): void {
  entry.closing = false;
  entry.status = 'pending';
  const channel = supabase
    .channel(entry.key)
    .on(
      'postgres_changes',
      {
        event: entry.event,
        schema: 'public',
        table: entry.table,
        ...(entry.filter ? { filter: entry.filter } : {}),
      },
      (payload: RealtimePostgresChangesPayload<any>) => fanout(entry, payload),
    );
  entry.channel = channel;
  channel.subscribe((status: string, err?: Error) => onStatus(entry, channel, status, err));
}

function closeChannel(entry: Entry): void {
  const channel = entry.channel;
  entry.channel = null;
  if (!channel) return;
  entry.closing = true;
  try {
    supabase.removeChannel(channel);
  } catch (e) {
    reportError(e, { source: 'realtime:removeChannel', topic: entry.key });
  }
}

function scheduleReopen(entry: Entry): void {
  if (entry.reopenTimer) return;
  if (entry.reopenAttempts >= REOPEN_MAX_ATTEMPTS) {
    reportReopenExhausted(entry);
    return;
  }
  const delay = jitter(REOPEN_BASE_MS * 2 ** entry.reopenAttempts);
  entry.reopenAttempts += 1;
  entry.reopenTimer = setTimeout(() => {
    entry.reopenTimer = null;
    if (!registry.has(entry.key) || entry.subscribers.size === 0) return;
    addBreadcrumb('realtime', 'reopening', { topic: entry.key, attempt: entry.reopenAttempts });
    closeChannel(entry);
    openChannel(entry);
  }, delay);
}

function reportReopenExhausted(entry: Entry): void {
  reportMessage(
    `realtime.reopen_exhausted [${entry.key}]`,
    'error',
    { topic: entry.key, table: entry.table, attempts: entry.reopenAttempts },
    { realtime_topic: entry.key, realtime_table: entry.table },
  );
}

function scheduleTeardown(entry: Entry): void {
  if (entry.teardownTimer) return;
  entry.teardownTimer = setTimeout(() => {
    entry.teardownTimer = null;
    if (entry.subscribers.size > 0) return; // someone came back
    registry.delete(entry.key);
    if (entry.reopenTimer) {
      clearTimeout(entry.reopenTimer);
      entry.reopenTimer = null;
    }
    clearRejoinWatchdog(entry);
    clearReconnectTimers(entry);
    closeChannel(entry);
    addBreadcrumb('realtime', 'left', { topic: entry.key });
  }, TEARDOWN_GRACE_MS);
}

/**
 * Subscribe to postgres_changes on a table.
 * Returns an unsubscribe function for useEffect cleanup.
 *
 * Callers that pass the same channelName share one channel. If two callers
 * use the same name for different table/event/filter shapes, the second is
 * quietly given its own channel (name + hash) rather than silently
 * receiving the first one's events.
 */
export function subscribeToTable(
  channelName: string,
  table: string,
  event: ChangeEvent,
  callback: Handler,
  filter?: string,
  options?: SubscribeOptions,
): () => void {
  const signature = signatureOf(table, event, filter);
  let key = channelName;
  const named = registry.get(channelName);
  if (named && named.signature !== signature) {
    key = `${channelName}:${shortHash(signature)}`;
  }

  let entry = registry.get(key);
  if (!entry) {
    entry = {
      key,
      table,
      event,
      filter,
      signature,
      channel: null,
      subscribers: new Set(),
      status: 'pending',
      subscribedOnce: false,
      closing: false,
      teardownTimer: null,
      reopenTimer: null,
      reconnectTimers: new Set(),
      rejoinWatchdog: null,
      reopenAttempts: 0,
      errors: 0,
      rejoins: 0,
      lastReportAt: {},
    };
    registry.set(key, entry);
    openChannel(entry);
  } else if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }

  const sub: Subscriber = { handler: callback, onReconnect: options?.onReconnect };
  entry.subscribers.add(sub);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const e = registry.get(key);
    if (!e) return;
    e.subscribers.delete(sub);
    if (e.subscribers.size === 0) scheduleTeardown(e);
  };
}

export interface RealtimeTopicDiagnostics {
  topic: string;
  table: string;
  event: ChangeEvent;
  filter: string | null;
  status: EntryStatus;
  subscribers: number;
  subscribedOnce: boolean;
  errors: number;
  rejoins: number;
}

/**
 * What the registry believes vs. what the socket holds. `socketChannels`
 * counts presence channels too, so it is normally `topics.length` plus
 * however many chat rooms are open.
 */
export function getRealtimeDiagnostics(): {
  topics: RealtimeTopicDiagnostics[];
  socketChannels: number;
  socketConnected: boolean;
} {
  const topics = Array.from(registry.values()).map((e) => ({
    topic: e.key,
    table: e.table,
    event: e.event,
    filter: e.filter ?? null,
    status: e.status,
    subscribers: e.subscribers.size,
    subscribedOnce: e.subscribedOnce,
    errors: e.errors,
    rejoins: e.rejoins,
  }));
  let socketChannels = 0;
  try {
    socketChannels = supabase.getChannels().length;
  } catch {
    /* getChannels is absent in some test doubles */
  }
  return { topics, socketChannels, socketConnected: socketConnected() };
}

/** Test hook: drop every entry without touching the socket. */
export function _resetRealtimeRegistryForTests(): void {
  for (const e of registry.values()) {
    if (e.teardownTimer) clearTimeout(e.teardownTimer);
    if (e.reopenTimer) clearTimeout(e.reopenTimer);
    if (e.rejoinWatchdog) clearTimeout(e.rejoinWatchdog);
    clearReconnectTimers(e);
  }
  registry.clear();
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
 *
 * Presence topics are per-room and have exactly one consumer, so they
 * stay outside the shared registry above.
 */
export function subscribeToPresence(
  channelName: string,
  onSync: (presenceState: Record<string, any[]>) => void,
  trackPayload?: Record<string, any>,
): () => void {
  // P3.3 kill switch: presence is O(n^2) on join churn; off means the
  // "online now" count simply stays absent.
  if (!isFeatureEnabled('presence')) return () => {};
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
  let joinedOnce = false;

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
      .subscribe(async (status: string, err?: Error) => {
        if (status === 'SUBSCRIBED') {
          addBreadcrumb('realtime', joinedOnce ? 'presence.rejoined' : 'presence.joined', {
            topic: channelName,
          });
          joinedOnce = true;
          if (trackPayload) {
            try {
              await channel.track(trackPayload);
            } catch (e) {
              reportError(e, {
                source: 'realtime:presenceTrack',
                channelName,
              });
            }
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Same split as the table channels: a failure before the first
          // join is a rejected join and worth a warning; after a join it is
          // the socket dropping, and the channel rejoins on its own.
          if (!joinedOnce) {
            reportMessage(
              `realtime.presence_join_rejected [${channelName}]`,
              'warning',
              { topic: channelName, status, socketConnected: socketConnected(), detail: err?.message ?? null },
              { realtime_topic: channelName },
            );
          } else {
            addBreadcrumb('realtime', 'presence.channel_error.after_join', {
              topic: channelName,
              status,
              socketConnected: socketConnected(),
              detail: err?.message ?? null,
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
  onReconnect?: () => void,
): () => void {
  // P3.3 kill switch: with games_realtime off the screens keep their REST
  // reads (60 s stale-time, focus refetch) and simply do not join.
  if (!isFeatureEnabled('games_realtime')) return () => {};
  return subscribeToTable(
    'games-realtime',
    'games',
    'UPDATE',
    (payload) => onUpdate(payload.new),
    undefined,
    { onReconnect },
  );
}

/**
 * v9.4.3 (mig 087): venue_city is the venue's own city now; the metro
 * anchor is what "parties near <city>" means. First comma segment only,
 * matching how 087 backfills venue_metro. Case-insensitive because the
 * city string comes from user input / AsyncStorage and the metro from a
 * geocoder.
 */
export function watchPartyMatchesCity(row: { venue_metro?: string | null }, city: string): boolean {
  const want = city.split(',')[0]!.trim().toLowerCase();
  if (!want) return false;
  const have = (row?.venue_metro ?? '').toString().trim().toLowerCase();
  return have === want;
}

/**
 * Subscribe to watch party changes near a given city.
 *
 * UAT 2026-09-22 (first Sentry `realtime.channel_error` after Phase 1 made
 * joins visible): this channel had never joined. Two reasons, each fatal
 * on its own: `watch_parties` was never added to the supabase_realtime
 * publication (migration 100 does that), and the filter used `ilike`,
 * which Realtime does not support (eq, neq, lt, lte, gt, gte, in only).
 * So the INSERT hook and the "belt-and-braces" invalidation in Home never
 * ran; parties only ever showed up on the stale-time refetch.
 *
 * Now: one unfiltered `watch-parties` topic, shared by Home and Discover
 * through the registry, with the metro match done client-side. Party
 * inserts are rare (tens per day app-wide), so the traffic is negligible
 * and the match cannot be broken by casing or a filter operator again.
 */
export function subscribeToWatchParties(
  city: string,
  onInsert: (party: any) => void,
  onUpdate?: (party: any) => void,
): () => void {
  return subscribeToTable(
    'watch-parties',
    'watch_parties',
    '*',
    (payload) => {
      const row = payload.new as any;
      if (!watchPartyMatchesCity(row, city)) return;
      if (payload.eventType === 'INSERT') {
        onInsert(row);
      } else if (payload.eventType === 'UPDATE' && onUpdate) {
        onUpdate(row);
      }
    },
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
 * Subscribe to new messages in a chat room. `onReconnect` fires after the
 * channel re-joins; the chat screen uses it to fetch anything sent while
 * the socket was down.
 */
export function subscribeToMessages(
  chatRoomId: string,
  onInsert: (message: any) => void,
  onReconnect?: () => void,
): () => void {
  return subscribeToTable(
    `room-messages-${chatRoomId}`,
    'messages',
    'INSERT',
    (payload) => onInsert(payload.new),
    `chat_room_id=eq.${chatRoomId}`,
    { onReconnect },
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
  const enabled = useKillSwitch('games_realtime');

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const invalidateSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['games'] });
        timer = null;
      }, GAMES_INVALIDATION_DEBOUNCE_MS);
    };

    // A re-join means score updates were missed while the channel was
    // down; one invalidation catches the cache up.
    const unsubscribe = subscribeToGames(invalidateSoon, invalidateSoon);

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [queryClient, enabled]);
}
