import { fetchHomeGames, loadHomeGames } from '../lib/homeGameQuery';
import { selectTodaysGames } from '../lib/homeGames';
import { getCache, getStaleCache, setCache } from '../lib/cache';

jest.mock('../lib/cache', () => ({ getCache: jest.fn(async () => null), getStaleCache: jest.fn(async () => null), setCache: jest.fn(async () => undefined) }));
beforeEach(() => { jest.clearAllMocks(); (getCache as jest.Mock).mockResolvedValue(null); (getStaleCache as jest.Mock).mockResolvedValue(null); });

it('SKYC-127 includes yesterday afternoon finals after 24h and a minority sport after row100', async () => {
  const now = new Date(2026, 9, 15, 23, 0);
  const rows = Array.from({ length: 125 }, (_, i) => ({
    id: 'g' + i, status: 'post', sport_id: i === 124 ? 'mlb' : 'nba',
    scheduled_at: new Date(2026, 9, 14, 13, i % 60).toISOString(),
    home_team: { id: 'h'+i, name: 'Home' }, away_team: { id: 'a'+i, name: 'Away' },
  }));
  const bounds: Record<string, string> = {};
  const pages: number[] = [];
  const client = { from: jest.fn(() => {
    const q: any = {};
    for (const method of ['select', 'not', 'order']) q[method] = jest.fn(() => q);
    q.gte = jest.fn((_: string, at: string) => { bounds.lo = at; return q; });
    q.lt = jest.fn((_: string, at: string) => { bounds.hi = at; return q; });
    q.range = jest.fn(async (lo: number, hi: number) => {
      pages.push(lo);
      return { data: rows.filter(r => r.scheduled_at >= bounds.lo && r.scheduled_at < bounds.hi).slice(lo, hi + 1), error: null };
    });
    return q;
  }) };
  const games = await fetchHomeGames(client, 'yesterday', now);
  expect(pages).toEqual([0, 100]);
  expect(games).toHaveLength(125);
  expect(selectTodaysGames(games, new Set(['mlb']), 'yesterday', now).map(g => g.id)).toEqual(['g124']);
  expect(new Date(bounds.lo).getDate()).toBe(14);
  expect(new Date(bounds.hi).getDate()).toBe(15);
});

it('does not silently return a partial day when a later page fails', async () => {
  let page = 0;
  const client = { from: () => {
    const q: any = {};
    for (const method of ['select', 'not', 'order', 'gte', 'lt']) q[method] = () => q;
    q.range = async () => ++page === 1 ? { data: Array(100).fill({}), error: null } : { data: null, error: new Error('page failed') };
    return q;
  } };
  await expect(fetchHomeGames(client, 'today')).rejects.toThrow('page failed');
});

it('serves stale data on a timed-out request and bounds an empty/offline cold start', async () => {
  const cached = [{ id: 'offline-game' }] as any;
  const q: any = {};
  for (const method of ['select', 'not', 'order', 'gte', 'lt', 'abortSignal']) q[method] = () => q;
  q.range = () => q;
  q.then = () => new Promise(() => {});
  const client = { from: () => q };
  (getStaleCache as jest.Mock).mockResolvedValue({ data: cached });
  expect(await loadHomeGames(client, 'today', new Date(), undefined, true, 10)).toBe(cached);
  expect(setCache).not.toHaveBeenCalled();
  (getStaleCache as jest.Mock).mockResolvedValue(null);
  await expect(loadHomeGames(client, 'today', new Date(), undefined, true, 10)).rejects.toThrow('timed out');
});

it('bypasses the cold-start cache for a refetch', async () => {
  const cached = [{ id: 'cached' }] as any;
  (getCache as jest.Mock).mockResolvedValue(cached);
  expect(await loadHomeGames({}, 'today', new Date())).toBe(cached);
  expect(getCache).toHaveBeenCalledTimes(1);
  const client = { from: () => { throw new Error('server reached'); } };
  await expect(loadHomeGames(client, 'today', new Date(), undefined, true)).rejects.toThrow('server reached');
  expect(getCache).toHaveBeenCalledTimes(1);
});
