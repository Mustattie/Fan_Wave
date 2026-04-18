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

export function useGames(limit = 10) {
  return useQuery<GameDisplay[]>({
    queryKey: ['games', limit],
    queryFn: async () => {
      const cached = await getCache<GameDisplay[]>('games');
      if (cached) return cached;

      try {
        const { data, error } = await withTimeout(
          () => supabase
            .from('games')
            .select('*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)')
            .gte('scheduled_at', new Date().toISOString().split('T')[0])
            .order('scheduled_at', { ascending: true })
            .limit(limit),
          FETCH_TIMEOUT
        );

        if (error) throw error;
        const mapped = (data || []).map(mapGameToDisplay);
        await setCache('games', mapped);
        return mapped;
      } catch {
        const stale = await getStaleCache<GameDisplay[]>('games');
        return stale?.data ?? [];
      }
    },
    staleTime: 60 * 1000,
  });
}

// ─── Watch Parties ──────────────────────────────────────────

export function useWatchParties(city: string, limit = 3) {
  return useQuery<WatchPartyDisplay[]>({
    queryKey: ['watchParties', city, limit],
    queryFn: async () => {
      const cached = await getCache<WatchPartyDisplay[]>('watchParties', city);
      if (cached) return cached;

      try {
        const { data, error } = await withTimeout(
          () => supabase
            .from('watch_parties')
            .select('*, sport:sports!sport_id(*)')
            .ilike('venue_city', city)
            .gt('starts_at', new Date().toISOString())
            .order('starts_at', { ascending: true })
            .limit(limit),
          FETCH_TIMEOUT
        );

        if (error) throw error;
        const mapped = (data || []).map(mapWatchPartyToDisplay);
        await setCache('watchParties', mapped, city);
        return mapped;
      } catch {
        const stale = await getStaleCache<WatchPartyDisplay[]>('watchParties', city);
        return stale?.data ?? [];
      }
    },
    enabled: !!city,
  });
}

// ─── Watch Parties (cursor-based infinite for Discover) ─────

export function useWatchPartiesInfinite(city: string) {
  return useInfiniteQuery<WatchPartyDisplay[]>({
    queryKey: ['watchPartiesInfinite', city],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('watch_parties')
        .select('*, sport:sports!sport_id(*)')
        .ilike('venue_city', city)
        .gt('starts_at', new Date().toISOString())
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
      const cached = await getCache<ChatRoomDisplay[]>('groups');
      if (cached) return cached;

      try {
        const { data: { user } } = await withTimeout(() => supabase.auth.getUser(), FETCH_TIMEOUT);
        if (!user) return [];

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
        await setCache('groups', mapped);
        return mapped;
      } catch {
        const stale = await getStaleCache<ChatRoomDisplay[]>('groups');
        return stale?.data ?? [];
      }
    },
  });
}

// ─── User City ──────────────────────────────────────────────

export function useUserCity() {
  return useQuery<string>({
    queryKey: ['userCity'],
    queryFn: async () => {
      const storedCity = await AsyncStorage.getItem('user_city');
      return storedCity || 'Chicago';
    },
    staleTime: Infinity,
  });
}
