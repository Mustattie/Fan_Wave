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
  // Codex review 2026-09-26 (P2): neighbouring CALENDAR midnights, not
  // midnight +/- 24 h. On a daylight-saving day the local day is 23 or 25
  // hours long; the fixed span ended "today" at 23:00 on the fall-back
  // date (dropping the day's last hour) and reached into tomorrow in
  // spring. Date(y, m, d + 1) lets the JS engine apply the local offset.
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const startOfToday = new Date(y, m, d).getTime();
  const startOfTomorrow = new Date(y, m, d + 1).getTime();
  const startOfYesterday = new Date(y, m, d - 1).getTime();
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
