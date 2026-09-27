/**
 * Codex review 2026-09-26: the two pure-logic findings.
 *  - P2 local-day boundaries across daylight-saving changes (lib/homeGames)
 *  - P1 async load completion must not start playback off-screen
 *    (lib/clipsFeed mayStartPlayback; the screen wires it to focus/AppState)
 * The tests are timezone-agnostic: they assert the boundaries are the
 * neighbouring local calendar midnights, whatever the machine's zone.
 */
import { localDayWindow, selectTodaysGames } from '../lib/homeGames';
import { mayStartPlayback } from '../lib/clipsFeed';
import { SharedVideoSource } from '../lib/sharedVideoSource';

function localMidnight(y: number, m: number, d: number) {
  return new Date(y, m, d).getTime();
}

describe('localDayWindow across daylight-saving transitions', () => {
  const cases = [
    { label: 'US fall back 2026-11-01', y: 2026, m: 10, d: 1 },
    { label: 'US spring forward 2026-03-08', y: 2026, m: 2, d: 8 },
    { label: 'EU transition 2026-10-25', y: 2026, m: 9, d: 25 },
    { label: 'ordinary day 2026-09-25', y: 2026, m: 8, d: 25 },
  ];
  for (const c of cases) {
    it(`today and yesterday are bounded by calendar midnights: ${c.label}`, () => {
      const now = new Date(c.y, c.m, c.d, 4, 31);
      const [lo, hi] = localDayWindow('today', now);
      expect(lo).toBe(localMidnight(c.y, c.m, c.d));
      expect(hi).toBe(localMidnight(c.y, c.m, c.d + 1));
      const [ylo, yhi] = localDayWindow('yesterday', now);
      expect(ylo).toBe(localMidnight(c.y, c.m, c.d - 1));
      expect(yhi).toBe(lo);
      // The day's last hour belongs to today, DST or not.
      const lastHour = new Date(c.y, c.m, c.d, 23, 30).getTime();
      expect(lastHour >= lo && lastHour < hi).toBe(true);
      // The first minute of tomorrow does not.
      const tomorrowEarly = new Date(c.y, c.m, c.d + 1, 0, 1).getTime();
      expect(tomorrowEarly < hi).toBe(false);
    });
  }

  it('selectTodaysGames keeps a 23:30 game on the fall-back day', () => {
    const now = new Date(2026, 10, 1, 4, 31);
    const late = { id: 'late', status: 'scheduled', sport: 'nhl', scheduledAt: new Date(2026, 10, 1, 23, 30).toISOString() } as any;
    const tomorrow = { id: 'tmrw', status: 'scheduled', sport: 'nhl', scheduledAt: new Date(2026, 10, 2, 0, 30).toISOString() } as any;
    expect(selectTodaysGames([late, tomorrow], null, 'today', now).map((g) => g.id)).toEqual(['late']);
  });
});

describe('mayStartPlayback (P1: late loads cannot play off-screen)', () => {
  const base = { autoplayEnabled: true, forcePause: false, focused: true, appState: 'active' as const };
  it('plays only when autoplay is on, the tab is focused, the app is active and no forced pause', () => {
    expect(mayStartPlayback(base)).toBe(true);
    expect(mayStartPlayback({ ...base, focused: false })).toBe(false);
    expect(mayStartPlayback({ ...base, appState: 'background' })).toBe(false);
    expect(mayStartPlayback({ ...base, forcePause: true })).toBe(false);
    expect(mayStartPlayback({ ...base, autoplayEnabled: false })).toBe(false);
  });

  it('refuses every non-active AppState, including iOS inactive (the handler pauses there too)', () => {
    // Codex commit-gate re-review: a replaceAsync load that completes while
    // iOS is 'inactive' used to see backgrounded=false and call play().
    expect(mayStartPlayback({ ...base, appState: 'inactive' })).toBe(false);
    expect(mayStartPlayback({ ...base, appState: 'unknown' })).toBe(false);
    expect(mayStartPlayback({ ...base, appState: 'extension' })).toBe(false);
    expect(mayStartPlayback({ ...base, appState: 'active' })).toBe(true);
  });

  it('release() during a pending first load makes that load resolve stale', async () => {
    let resolveLoad: () => void = () => {};
    const replaceAsync = jest.fn((src: any) =>
      src === null ? Promise.resolve() : new Promise<void>((r) => { resolveLoad = r; }),
    );
    const source = new SharedVideoSource({ replaceAsync });
    const pending = source.load('https://cdn/a.mp4');
    expect(source.currentUri).toBeNull();
    expect(source.pendingUri).toBe('https://cdn/a.mp4');
    // App goes to background before the load resolves: the screen now
    // releases when EITHER currentUri or pendingUri is set.
    await source.release();
    resolveLoad();
    expect(await pending).toEqual({ outcome: 'stale' });
    expect(source.currentUri).toBeNull();
    expect(source.pendingUri).toBeNull();
  });
});
