import { mapGameToDisplay, type GameDisplay } from './mappers';
import { localDayWindow, type HomeDayFilter } from './homeGames';
import { getCache, getStaleCache, setCache } from './cache';

// Fetch the complete local calendar day before applying sport interests.
// A global 30-row cap or rolling 24h window can silently omit a followed sport.
export async function fetchHomeGames(client: any, day: HomeDayFilter, now = new Date(), signal?: AbortSignal): Promise<GameDisplay[]> {
  const [lo, hi] = localDayWindow(day, now);
  const rows: any[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('games')
      .select('*, home_team:teams!home_team_id(*), away_team:teams!away_team_id(*)')
      .not('home_team_id', 'is', null).not('away_team_id', 'is', null)
      .gte('scheduled_at', new Date(lo).toISOString())
      .lt('scheduled_at', new Date(hi).toISOString())
      .order('scheduled_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows.map(mapGameToDisplay);
}

/** Preserve offline data without turning a timeout into a successful empty day. */
export async function loadHomeGames(client: any, day: HomeDayFilter, now: Date, signal?: AbortSignal, isRefetch = false, timeoutMs = 10_000): Promise<GameDisplay[]> {
  const [lo, hi] = localDayWindow(day, now);
  const key = `home-${lo}-${hi}`;
  const cached = isRefetch ? null : await getCache<GameDisplay[]>('games', key);
  if (cached?.length) return cached;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const games = await Promise.race([
      fetchHomeGames(client, day, now, controller.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Games request timed out')); }, timeoutMs); }),
    ]);
    if (games.length) await setCache('games', games, key);
    return games;
  } catch (error) {
    if (signal?.aborted) throw error;
    const stale = await getStaleCache<GameDisplay[]>('games', key);
    if (stale?.data?.length) return stale.data;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function homeGamesCacheKey(day: HomeDayFilter, now = new Date()) {
  const [lo, hi] = localDayWindow(day, now);
  return `home-${lo}-${hi}`;
}
