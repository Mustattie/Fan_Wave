import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase, getLocalUser } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCache, getCache, getStaleCache, invalidateCache } from '@/lib/cache';
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

// Subkeys (per limit) that have been written to the AsyncStorage games
// cache this session, so a manual refresh can drop all of them.
const gamesCacheSubkeys = new Set<string>();

/**
 * Build 31 UAT (2026-09-25): pull-to-refresh on Home re-ran the query but
 * the queryFn's AsyncStorage shortcut handed back the same rows for 30 s,
 * so a refresh could never disagree with what was already on screen. The
 * two refresh handlers call this first so a manual pull always reaches
 * the server.
 */
export async function clearGamesCache(): Promise<void> {
  await Promise.all(Array.from(gamesCacheSubkeys).map((k) => invalidateCache('games', k)));
}

/**
 * Sort helper for the merged list: live first, then finals, then upcoming,
 * chronological inside each group -- the order the old single query
 * produced (status asc: 'in' < 'post' < 'scheduled'), kept so the Home
 * carousel and Game Day sections read the same as before.
 */
function statusRank(status: string | undefined): number {
  return status === 'live' ? 0 : status === 'final' ? 1 : 2;
}
export function mergeGameLegs(live: GameDisplay[], finals: GameDisplay[], upcoming: GameDisplay[]): GameDisplay[] {
  const byId = new Map<string, GameDisplay>();
  for (const g of [...live, ...finals, ...upcoming]) if (!byId.has(g.id)) byId.set(g.id, g);
  return Array.from(byId.values()).sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    if (r !== 0) return r;
    return (a.scheduledAt || '').localeCompare(b.scheduledAt || '');
  });
}

const GAME_SELECT = '*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)';

export function useGames(limit = 30) {
  // Subkey on the cache so a bumped limit doesn't return a stale shorter
  // list.
  const subkey = String(limit);
  gamesCacheSubkeys.add(subkey);
  return useQuery<GameDisplay[]>({
    queryKey: ['games', limit],
    queryFn: async () => {
      const cached = await getCache<GameDisplay[]>('games', subkey);
      // v9.4.0 UAT Round 3: treat empty AsyncStorage cache as
      // "not yet loaded" rather than "confirmed no games". Arrays are
      // truthy so `if (cached)` returned [] as valid cache -- if a
      // previous session cached [] during a transient empty moment or
      // after a Supabase timeout, the next 30s of app opens returned
      // that empty list even after ESPN had synced fresh scores. That
      // was the Game Day cold-load empty-state race (#13): the user
      // opens the app, sees "No games live", pulls to refresh, and
      // populates because RQ's invalidateQueries blows THIS cache
      // too. Only shortcut on a cache hit with actual entries.
      if (cached && cached.length > 0) return cached;

      try {
        // Build 31 UAT (2026-09-25), Home "Today's Games" empty while Game
        // Day showed the same day's MLB games: the old single query
        // ordered `status asc` ('in' < 'post' < 'scheduled') and applied
        // ONE limit across all three legs. With exactly 30 finals inside
        // the 24 h window, Home's limit of 30 returned nothing but
        // yesterday's finals, its local-day cut dropped them all, and
        // pull-to-refresh re-fetched the identical 30 rows. Game Day asks
        // for 50 and happened to get 20 scheduled rows.
        //
        // Two legs, each with its own limit, so finals can never starve
        // upcoming games (or the reverse):
        //   * live + scheduled  -- status 'in' always; 'scheduled' if not
        //     yet started, 4 h grace for ESPN sync lag; earliest first, so
        //     today's slate is always at the front of the window
        //   * finals            -- 'post' that ended in the last ~24 h,
        //     most recent first
        // Orphaned rows (a null team FK) are dropped on both legs
        // (v9.4.2 UAT).
        const upcomingCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        const finishedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const [ahead, finals] = await withTimeout(
          () =>
            Promise.all([
              supabase
                .from('games')
                .select(GAME_SELECT)
                .not('home_team_id', 'is', null)
                .not('away_team_id', 'is', null)
                .in('status', ['in', 'scheduled'])
                .gte('scheduled_at', upcomingCutoff)
                .order('scheduled_at', { ascending: true })
                .limit(limit),
              supabase
                .from('games')
                .select(GAME_SELECT)
                .not('home_team_id', 'is', null)
                .not('away_team_id', 'is', null)
                .eq('status', 'post')
                .gte('scheduled_at', finishedCutoff)
                .order('scheduled_at', { ascending: false })
                .limit(limit),
            ]),
          FETCH_TIMEOUT
        );

        if (ahead.error) throw ahead.error;
        if (finals.error) throw finals.error;
        const aheadMapped = (ahead.data || []).map(mapGameToDisplay);
        const mapped = mergeGameLegs(
          aheadMapped.filter((g) => g.status === 'live'),
          (finals.data || []).map(mapGameToDisplay),
          aheadMapped.filter((g) => g.status !== 'live'),
        );
        // v9.4.0 UAT Round 3: only cache non-empty results. Storing []
        // would re-poison the `cached && cached.length > 0` shortcut on
        // the next call and re-open the cold-load empty race.
        if (mapped.length > 0) {
          await setCache('games', mapped, subkey);
        }
        return mapped;
      } catch (err) {
        // v9.4.0 UAT Round 3: previously returned `stale?.data ?? []`
        // on any failure. That silently converted a Supabase timeout
        // into an empty-array success from RQ's perspective, which RQ
        // then cached for the 60s staleTime. Users saw "No games" for
        // 60s after a single failed call and only pull-to-refresh
        // could recover. Prefer stale cache if we have entries; else
        // rethrow so RQ retries with its built-in backoff and surfaces
        // a real error state rather than a misleading empty one.
        const stale = await getStaleCache<GameDisplay[]>('games', subkey);
        if (stale?.data && stale.data.length > 0) return stale.data;
        throw err;
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

        // Local-metro query first.
        //
        // v9.4.3 (mig 087): venue_city now names the VENUE's city, so a
        // McKinney bar no longer reads as "Dallas". Matching moved to
        // venue_metro -- the creator's home city, which is what venue_city
        // used to hold. The OR keeps rows written by pre-087 clients (metro
        // still NULL) matching on venue_city as before.
        const localSelect = () =>
          supabase
            .from('watch_parties')
            .select('*, sport:sports!sport_id(*)')
            .gt('starts_at', startedAfter)
            .order('starts_at', { ascending: true })
            .limit(limit);

        // Normalise to the bare locality: home_city is stored as a mix of
        // "Dallas" and "Dallas, Texas", and mig 087 writes venue_metro the
        // same first-segment way, so both sides have to agree. (Before this,
        // a "Dallas, Texas" profile matched only rows that happened to store
        // the state too.) Quoted because PostgREST treats , . ( ) : as
        // syntax inside or(). No wildcards -- ilike here is exact-match,
        // same as the .ilike() call it replaces.
        const anchor = `"${city.split(',')[0]!.trim().replace(/"/g, '')}"`;
        let { data: localData, error: localError } = await withTimeout(
          () => localSelect().or(
            `venue_metro.ilike.${anchor},venue_city.ilike.${anchor}`
          ),
          FETCH_TIMEOUT
        );

        // If venue_metro doesn't exist yet (migration 087 not applied on
        // this environment), don't blank the section -- fall back to the
        // pre-087 query rather than dropping into the offline-cache catch.
        if (localError) {
          const legacy = await withTimeout(
            () => localSelect().ilike('venue_city', city),
            FETCH_TIMEOUT
          );
          if (legacy.error) throw localError;
          localData = legacy.data;
          localError = null;
        }

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
        const { data: { user } } = await getLocalUser();
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
      const { data: { user } } = await withTimeout(() => getLocalUser(), FETCH_TIMEOUT);
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
          () => getLocalUser(),
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
