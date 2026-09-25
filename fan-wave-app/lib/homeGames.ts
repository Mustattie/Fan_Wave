// Home "Today's Games" selection, extracted from app/(tabs)/index.tsx so the
// Build 31 regression (2026-09-25) can be reproduced in a unit test.
//
// Pure: takes the games list useGames returned, the user's interest set
// and the day toggle, and returns what the carousel shows. The screen does
// nothing else with the list.

import type { GameDisplay } from './mappers';

export type HomeDayFilter = 'today' | 'yesterday';

/** Local-day boundaries [lo, hi) in ms for the device timezone. */
export function localDayWindow(dayFilter: HomeDayFilter, now: Date = new Date()): [number, number] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTomorrow = startOfToday + 24 * 60 * 60 * 1000;
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  return dayFilter === 'today' ? [startOfToday, startOfTomorrow] : [startOfYesterday, startOfToday];
}

/**
 * v9.4.0 UAT Round 3 (#2): "Today's Games" bled prior-day finals into
 * today because useGames returns anything within a 24h finished-cutoff
 * (server-side, TZ-agnostic). Cut to the local day, then to the user's
 * sports; if the interest cut would empty the carousel (an off-season
 * pick), fall back to the whole day-scoped set rather than show nothing.
 */
export function selectTodaysGames(
  games: GameDisplay[],
  interestSports: Set<string> | null,
  dayFilter: HomeDayFilter,
  now: Date = new Date(),
): GameDisplay[] {
  const [lo, hi] = localDayWindow(dayFilter, now);
  const withinDay = games.filter((g) => {
    if (!g.scheduledAt) return false;
    const t = new Date(g.scheduledAt).getTime();
    return t >= lo && t < hi;
  });
  if (!interestSports || interestSports.size === 0) return withinDay;
  const filtered = withinDay.filter((g) => {
    const sport = (g.sport || '').toLowerCase();
    if (!sport) return false;
    return interestSports.has(sport);
  });
  return filtered.length > 0 ? filtered : withinDay;
}
