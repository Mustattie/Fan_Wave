/**
 * Build 31 physical UAT (2026-09-25), Galaxy S10+: Home "Today's Games"
 * showed "No games on deck today" while Game Day listed the same day's
 * MLB games under Upcoming, before and after adding MLB in My Sports and
 * after pull-to-refresh.
 *
 * Root cause: useGames ran ONE query ordered `status asc` ('in' < 'post' <
 * 'scheduled') with one limit. Prod had exactly 30 finals in the 24 h
 * window, so Home's limit of 30 returned only yesterday's finals; its
 * local-day cut dropped them all. Game Day's limit of 50 got 20 scheduled
 * rows on top and so saw MLB. This test rebuilds that dataset and drives
 * both consumers through the real hook.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useGames, clearGamesCache, mergeGameLegs } from '../hooks/useData';
import { selectTodaysGames } from '../lib/homeGames';
import { invalidateCache } from '../lib/cache';

jest.mock('../lib/cache', () => ({
  getCache: jest.fn(async () => null),
  getStaleCache: jest.fn(async () => null),
  setCache: jest.fn(async () => undefined),
  invalidateCache: jest.fn(async () => undefined),
}));

// ─── Fixture: the prod window as it stood at 09:31 UTC on 2026-09-25 ────
const NOW = new Date(2026, 8, 25, 4, 31); // local time, same instant the UAT ran
const startOfToday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function row(id: string, status: 'in' | 'post' | 'scheduled', sport: string, at: number) {
  return {
    id,
    status,
    sport_id: sport,
    scheduled_at: iso(at),
    home_team_id: `${id}-h`,
    away_team_id: `${id}-a`,
    home_team: { id: `${id}-h`, name: `${id} Home`, logo_url: null },
    away_team: { id: `${id}-a`, name: `${id} Away`, logo_url: null },
    home_score: null,
    away_score: null,
    metadata: {},
  };
}

// 30 finals, all yesterday (local), across mlb / nhl / wnba -- the
// exact count that filled Home's old limit of 30.
const finals = Array.from({ length: 30 }, (_, i) =>
  row(`post-${i}`, 'post', ['mlb', 'nhl', 'wnba'][i % 3]!, startOfToday - 8 * H + i * 10 * 60 * 1000),
);
// Today's slate: 26 scheduled games, MLB heavy, none of them NFL/NBA/WNBA.
const upcoming = Array.from({ length: 26 }, (_, i) =>
  row(`sched-${i}`, 'scheduled', ['mlb', 'mlb', 'cfb', 'nhl'][i % 4]!, startOfToday + 12 * H + i * 15 * 60 * 1000),
);
// ...and a long tail of future games so a single limit would be hit.
const future = Array.from({ length: 200 }, (_, i) =>
  row(`future-${i}`, 'scheduled', 'mlb', startOfToday + 48 * H + i * H),
);

/**
 * A PostgREST-shaped fake: records the filters, and on `.limit()` answers
 * from the fixture the way the server would (status filter, cutoff,
 * order, then the limit).
 */
function installGamesTable() {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table !== 'games') throw new Error(`unexpected table ${table}`);
    const q: any = { statuses: null as string[] | null, gte: null as string | null, desc: false };
    const chain: any = {};
    chain.select = jest.fn(() => chain);
    chain.not = jest.fn(() => chain);
    chain.in = jest.fn((_col: string, values: string[]) => { q.statuses = values; return chain; });
    chain.eq = jest.fn((_col: string, value: string) => { q.statuses = [value]; return chain; });
    chain.gte = jest.fn((_col: string, value: string) => { q.gte = value; return chain; });
    chain.or = jest.fn(() => chain);
    chain.order = jest.fn((_col: string, opts?: { ascending?: boolean }) => { q.desc = opts?.ascending === false; return chain; });
    chain.limit = jest.fn(async (n: number) => {
      let rows = [...finals, ...upcoming, ...future];
      if (q.statuses) rows = rows.filter((r) => q.statuses.includes(r.status));
      if (q.gte) rows = rows.filter((r) => r.scheduled_at >= q.gte);
      rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      if (q.desc) rows.reverse();
      return { data: rows.slice(0, n), error: null };
    });
    return chain;
  });
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Game Day's "Upcoming" derivation: interest cut, then status === 'scheduled'. */
function gameDayUpcoming(games: any[], interest: Set<string>) {
  const cut = interest.size ? games.filter((g) => interest.has((g.sport || '').toLowerCase())) : games;
  return cut.filter((g) => g.status === 'scheduled');
}

describe('Home Today\'s Games vs Game Day (Build 31 regression)', () => {
  beforeEach(() => {
    // Fake only the clock: React Query and waitFor need real timers.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
    });
    (supabase.from as jest.Mock).mockReset();
    installGamesTable();
  });
  afterEach(() => jest.useRealTimers());

  it('Home (limit 30) receives today\'s scheduled games even when 30 finals fill the finished window', async () => {
    const { result } = renderHook(() => useGames(30), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const games = result.current.data!;

    // Both legs came back: finals capped at 30, and the day's slate.
    expect(games.filter((g) => g.status === 'final')).toHaveLength(30);
    expect(games.filter((g) => g.status === 'scheduled').length).toBeGreaterThanOrEqual(26);

    // Step 1-3 of the UAT: NFL / NBA / WNBA selected, no such games today.
    // The interest cut is empty, so Home falls back to the day's slate
    // rather than "No games on deck" -- what the old query could not do,
    // because it had no today rows at all.
    const before = selectTodaysGames(games, new Set(['nfl', 'nba', 'wnba']), 'today', NOW);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((g) => g.status === 'scheduled')).toBe(true);

    // Step 4-5: MLB added in My Sports; Game Day shows MLB under Upcoming.
    const { result: gameDay } = renderHook(() => useGames(50), { wrapper: wrapper() });
    await waitFor(() => expect(gameDay.current.data).toBeDefined());
    const upcomingOnGameDay = gameDayUpcoming(gameDay.current.data!, new Set(['nfl', 'nba', 'wnba', 'mlb']));
    expect(upcomingOnGameDay.length).toBeGreaterThan(0);
    expect(upcomingOnGameDay.every((g) => g.sport === 'mlb')).toBe(true);

    // Step 6: back on Home, the same interest set must select the same
    // MLB games from Home's own (limit 30) data -- no restart.
    const after = selectTodaysGames(games, new Set(['nfl', 'nba', 'wnba', 'mlb']), 'today', NOW);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((g) => g.sport === 'mlb' && g.status === 'scheduled')).toBe(true);
    // Game Day's Upcoming also lists tomorrow's slate ("what's next"), so
    // Home's today-only MLB set must equal Game Day's today-only subset and
    // be contained in the full Upcoming list.
    const gameDayToday = new Set(selectTodaysGames(upcomingOnGameDay as any, null, 'today', NOW).map((g) => g.id));
    expect(new Set(after.map((g) => g.id))).toEqual(gameDayToday);
    const upcomingIds = new Set(upcomingOnGameDay.map((g) => g.id));
    expect(after.every((g) => upcomingIds.has(g.id))).toBe(true);

    // Yesterday's finals never leak into "today".
    expect(after.some((g) => g.status === 'final')).toBe(false);
  });

  it('the day-scoped selection is empty only when the day really has no games', () => {
    const onlyFinals = finals.map((r) => ({ ...r, scheduledAt: r.scheduled_at, sport: r.sport_id, status: 'final' })) as any;
    expect(selectTodaysGames(onlyFinals, new Set(['mlb']), 'today', NOW)).toEqual([]);
    expect(selectTodaysGames(onlyFinals, new Set(['mlb']), 'yesterday', NOW)).toHaveLength(10);
  });

  it('pull-to-refresh drops the AsyncStorage games cache for every limit in use', async () => {
    const a = renderHook(() => useGames(30), { wrapper: wrapper() });
    const b = renderHook(() => useGames(50), { wrapper: wrapper() });
    await waitFor(() => expect(a.result.current.data && b.result.current.data).toBeTruthy());
    (invalidateCache as jest.Mock).mockClear();
    await clearGamesCache();
    const cleared = (invalidateCache as jest.Mock).mock.calls.map((c) => c[1]);
    expect(cleared).toEqual(expect.arrayContaining(['30', '50']));
  });

  it('mergeGameLegs orders live, finals, upcoming and dedupes by id', () => {
    const live = [{ id: 'l', status: 'live', scheduledAt: '2026-09-25T20:00:00Z' }] as any;
    const fin = [
      { id: 'f2', status: 'final', scheduledAt: '2026-09-24T22:00:00Z' },
      { id: 'f1', status: 'final', scheduledAt: '2026-09-24T18:00:00Z' },
    ] as any;
    const up = [
      { id: 'u', status: 'scheduled', scheduledAt: '2026-09-25T23:00:00Z' },
      { id: 'l', status: 'scheduled', scheduledAt: '2026-09-25T20:00:00Z' },
    ] as any;
    expect(mergeGameLegs(live, fin, up).map((g) => g.id)).toEqual(['l', 'f1', 'f2', 'u']);
  });
});
