import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { loadHomeGames } from '@/lib/homeGameQuery';
import { localDayWindow, type HomeDayFilter } from '@/lib/homeGames';

export function useHomeGames(day: HomeDayFilter) {
  const now = new Date();
  const [lo, hi] = localDayWindow(day, now);
  return useQuery({
    queryKey: ['games', 'home', lo, hi],
    queryFn: ({ signal, client, queryKey }) => loadHomeGames(supabase, day, now, signal, client.getQueryState(queryKey)?.data !== undefined),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
