import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCache, getCache, getStaleCache } from '@/lib/cache';
const FETCH_TIMEOUT = 10_000; // 10 seconds

/** Wrap any async call with a timeout that rejects after ms */
function withTimeout<T>(fn: () => PromiseLike<T> | Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), ms);
    Promise.resolve(fn())
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err: any) => { clearTimeout(timer); reject(err); });
  });
}
import {
  mapGameToDisplay,
  mapWatchPartyToDisplay,
  mapChatRoomToDisplay,
  type GameDisplay,
  type WatchPartyDisplay,
  type ChatRoomDisplay,
} from '@/lib/mappers';

const PAGE_SIZE = 20;

// ─── Games ──────────────────────────────────────────────────

export function useGames(limit = 30) {
  // Subkey on the cache so a bumped limit doesn't return a stale shorter
  // list. Filter out finished ('post') games — Today's Games should only
  // surface live + upcoming, otherwise late-tipping NBA playoffs get
  // pushed below the limit by all-day MLB schedules.
  const subkey = String(limit);
  return useQuery<GameDisplay[]>({
    queryKey: ['games', limit],
    queryFn: async () => {
      const cached = await getCache<GameDisplay[]>('games', subkey);
      if (cached) return cached;

      try {
        // Carousel composition:
        //   * status='in'        always show (live game)
        //   * status='scheduled' show if not yet started; 4h grace covers
        //     ESPN sync lag so a freshly-tipped game that's still 'scheduled'
        //     in our DB still appears
        //   * status='post'      show if it ended in the last ~24h — fans
        //     check scores after the buzzer; ESPN itself keeps yesterday's
        //     results visible into the next day
        // Ordering: 'in' < 'post' < 'scheduled' alphabetically, so ASC puts
        // live first, then today's finals, then upcoming. Within each group,
        // chronological.
        const upcomingCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        const finishedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await withTimeout(
          () => supabase
            .from('games')
            .select('*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)')
            // v9.0 pivot: World Cup is hidden from the app. The ESPN sync
            // default-sports filter (functions/sync-game-schedules) blocks
            // new WC rows; this filter suppresses legacy WC rows already
            // in the DB so Game Day / Home never render "Spain vs Belgium"
            // and similar leftover fixtures.
            .neq('sport_id', 'worldcup')
            .or(
              `status.eq.in,` +
              `and(status.eq.scheduled,scheduled_at.gte.${upcomingCutoff}),` +
              `and(status.eq.post,scheduled_at.gte.${finishedCutoff})`,
            )
            .order('status', { ascending: true })
            .order('scheduled_at', { ascending: true })
            .limit(limit),
          FETCH_TIMEOUT
        );

        if (error) throw error;
        const mapped = (data || []).map(mapGameToDisplay);
        await setCache('games', mapped, subkey);
        return mapped;
      } catch {
        const stale = await getStaleCache<GameDisplay[]>('games', subkey);
        return stale?.data ?? [];
      }
    },
    staleTime: 60 * 1000,
    // Realtime invalidations (lib/realtime.ts useGamesRealtime) drive the
    // common case. This catches the background → foreground gap where the
    // WebSocket suspends and missed events aren't replayed on reconnect.
    // useAppStateFocus in _layout.tsx bridges RN AppState → focusManager.
    refetchOnWindowFocus: true,
  });
}

// ─── Watch Parties ──────────────────────────────────────────

export function useWatchParties(city: string, limit = 3) {
  return useQuery<WatchPartyDisplay[]>({
    queryKey: ['watchParties', city, limit],
    queryFn: async () => {
      // v8.5 P0 (round 2): the old pattern read AsyncStorage FIRST
      // (1-hour TTL on the watchParties bucket per lib/cache.ts) and
      // returned the cached list before going to DB. That meant: user
      // creates a party → Realtime fires setQueryData (party visible) →
      // staleTime=0 triggers next refetch → queryFn runs → AsyncStorage
      // returns stale empty list → party DISAPPEARS until cache TTL
      // expires (up to an hour). UAT artefact: party appeared "after
      // 2 minutes" (random refetch jitter). New strategy: always hit DB
      // on queryFn; AsyncStorage is ONLY an offline fallback inside
      // the catch.
      try {
        const startedAfter = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

        // Local-city query first.
        const { data: localData, error: localError } = await withTimeout(
          () => supabase
            .from('watch_parties')
            .select('*, sport:sports!sport_id(*)')
            .ilike('venue_city', city)
            .gt('starts_at', startedAfter)
            .order('starts_at', { ascending: true })
            .limit(limit),
          FETCH_TIMEOUT
        );

        if (localError) throw localError;

        let rows = localData || [];

        // Broaden when local is empty so the "Watch Parties Near You" card
        // doesn't sit empty for users in smaller metros / users who haven't
        // updated their home city yet. Fallback fetches the next few
        // upcoming parties nationwide. The UI can read the `broadened`
        // marker to relabel the section header if desired.
        if (rows.length === 0) {
          const { data: broadData } = await withTimeout(
            () => supabase
              .from('watch_parties')
              .select('*, sport:sports!sport_id(*)')
              .gt('starts_at', startedAfter)
              .order('starts_at', { ascending: true })
              .limit(limit),
            FETCH_TIMEOUT
          );
          rows = broadData || [];
        }

        const mapped = rows.map(mapWatchPartyToDisplay);
        // Write-through: keep an offline-fallback copy. Reads happen
        // ONLY inside the catch below; this is no longer a hit-first
        // cache.
        await setCache('watchParties', mapped, city);
        return mapped;
      } catch {
        const stale = await getStaleCache<WatchPartyDisplay[]>('watchParties', city);
        return stale?.data ?? [];
      }
    },
    enabled: !!city,
    // Hit DB at most once per 30s on focus/refetch — prevents thrashing
    // the API while still letting newly-created parties surface quickly
    // once the user comes back to the tab.
    staleTime: 30 * 1000,
  });
}

// ─── My RSVPs (shared across all WatchPartyCard instances) ──
//
// v8.7+ P0: WatchPartyCard previously held rsvpStatus in component-local
// state initialised to 'none'. Effect: user RSVPs on Home → that card's
// state flips to 'going' → on Discover, a *different* WatchPartyCard
// instance for the same party renders fresh at 'none', showing the
// generic RSVP button. The user reported "RSVP not persisting" across
// tabs because of this split-state.
//
// Fix: lift "what parties has the current user RSVPed to" up to a single
// React Query cache. Every WatchPartyCard reads from it; the RSVP handler
// invalidates after a successful insert. As a bonus, this also doubles
// as the source-of-truth that rsvp-history.tsx can fall back to when its
// nested PostgREST select misbehaves (silent .catch on schema-cache
// drift was the v8.5-onwards "history blank" report).
export function useMyRsvps() {
  return useQuery<Record<string, 'going' | 'interested' | 'declined'>>({
    queryKey: ['myRsvps'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return {};
        const { data, error } = await withTimeout(
          () => supabase
            .from('watch_party_rsvps')
            .select('watch_party_id, status')
            .eq('user_id', user.id),
          FETCH_TIMEOUT,
        );
        if (error) {
          console.warn('[useMyRsvps] query error', error.code, error.message);
          return {};
        }
        const map: Record<string, 'going' | 'interested' | 'declined'> = {};
        (data || []).forEach((r: any) => {
          if (r.watch_party_id && r.status) map[r.watch_party_id] = r.status;
        });
        return map;
      } catch (e: any) {
        console.warn('[useMyRsvps] exception', e?.message);
        return {};
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

// ─── Watch Parties (cursor-based infinite for Discover) ─────

export function useWatchPartiesInfinite(city: string) {
  return useInfiniteQuery<WatchPartyDisplay[]>({
    queryKey: ['watchPartiesInfinite', city],
    queryFn: async ({ pageParam }) => {
      // 2h grace — mirrors useWatchParties (v8.5 P0)
      const startedAfter = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      let query = supabase
        .from('watch_parties')
        .select('*, sport:sports!sport_id(*)')
        .ilike('venue_city', city)
        .gt('starts_at', startedAfter)
        .order('starts_at', { ascending: true })
        .limit(PAGE_SIZE);

      if (pageParam) {
        query = query.gt('starts_at', pageParam as string);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(mapWatchPartyToDisplay);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last?.startsAt ?? undefined;
    },
    enabled: !!city,
  });
}

// ─── My Groups ──────────────────────────────────────────────

export function useMyGroups(limit = 3) {
  return useQuery<ChatRoomDisplay[]>({
    queryKey: ['myGroups', limit],
    queryFn: async () => {
      const { data: { user } } = await withTimeout(() => supabase.auth.getUser(), FETCH_TIMEOUT);
      if (!user) return [];

      // Cache must be user-scoped — Bulls Nation Chicago surfaced in
      // production UAT for a Dallas user because the global 'groups'
      // cache was bleeding membership lists across auth identities
      // (dev seed users, prior reviewer logins, etc.).
      const cacheKey = user.id;
      const cached = await getCache<ChatRoomDisplay[]>('groups', cacheKey);
      if (cached) return cached;

      try {
        const { data, error } = await withTimeout(
          () => supabase
            .from('chat_room_members')
            .select('chat_room:chat_rooms(*)')
            .eq('user_id', user.id)
            .limit(limit),
          FETCH_TIMEOUT
        );

        if (error) throw error;
        const mapped = data && data.length > 0
          ? data.map((d: any) => mapChatRoomToDisplay(d.chat_room))
          : [];
        await setCache('groups', mapped, cacheKey);
        return mapped;
      } catch {
        const stale = await getStaleCache<ChatRoomDisplay[]>('groups', cacheKey);
        return stale?.data ?? [];
      }
    },
  });
}

// ─── User City ──────────────────────────────────────────────

// v8.6 P0: DB-backed source of truth for the user's home city. The v8.5
// implementation read AsyncStorage with staleTime:Infinity, which meant a
// profile change ("Chicago" → "Dallas") was invisible to every consumer
// until the app was reinstalled — the screenshot fingerprint was Home
// showing Chicago, IL after a Dallas save, and the user's freshly-created
// Dallas watch party not appearing for ~2 min (the Home query filtered
// by venue_city='Chicago', so the Realtime INSERT for Dallas never
// matched the channel filter either). DB is now the primary read with
// short staleTime + refetch on focus; AsyncStorage is offline fallback.
//
// Companion edits:
//   • edit-profile.tsx invalidates ['userCity'] + ['watchParties'] on save
//     so the new city propagates without a tab switch.
//   • app/(tabs)/index.tsx Realtime useFocusEffect now depends on [city]
//     so the channel filter re-binds when the user changes city.
export function useUserCity() {
  return useQuery<string>({
    queryKey: ['userCity'],
    queryFn: async () => {
      try {
        const { data: { user } } = await withTimeout(
          () => supabase.auth.getUser(),
          FETCH_TIMEOUT
        );
        if (user) {
          const { data } = await withTimeout(
            () => supabase
              .from('users')
              .select('home_city')
              .eq('auth_id', user.id)
              .maybeSingle(),
            FETCH_TIMEOUT
          );
          const dbCity = (data?.home_city || '').toString().trim();
          if (dbCity) {
            AsyncStorage.setItem('user_city', dbCity).catch(() => {});
            return dbCity;
          }
        }
      } catch {
        // Network down — fall through to AsyncStorage fallback.
      }
      const storedCity = await AsyncStorage.getItem('user_city');
      return storedCity || '';
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
