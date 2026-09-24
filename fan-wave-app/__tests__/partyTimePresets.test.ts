import {
  computeGameTimePresets,
  formatGameTimeChip,
  PAST_GRACE_MS,
} from '../lib/partyTimePresets';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function at(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

describe('computeGameTimePresets (v9.5.19: linked-game start time)', () => {
  // A fixed "now" mid-morning local so "later today" stays on the same
  // local day in any test-runner timezone.
  const now = new Date(2026, 8, 24, 9, 0, 0, 0); // Sep 24 2026 09:00 local

  it('defaults to the game instant and offers 30 min / 1 hr before', () => {
    const game = at(now, 3 * HOUR);
    const presets = computeGameTimePresets(game, now);
    expect(presets.map((p) => p.label)).toEqual([
      `Game time · ${localTime(game)}`,
      '30 min before',
      '1 hr before',
    ]);
    expect(presets[0]!.value).toBe(game);
    // Instant arithmetic: exact offsets in ms regardless of DST or zone.
    expect(new Date(game).getTime() - new Date(presets[1]!.value).getTime()).toBe(30 * MIN);
    expect(new Date(game).getTime() - new Date(presets[2]!.value).getTime()).toBe(60 * MIN);
  });

  it('drops "before" chips that are already past the grace cutoff', () => {
    // Game in 40 min: 30-min-before is +10 min (kept); 1-hr-before is
    // -20 min, past the 15-minute grace (dropped).
    const presets = computeGameTimePresets(at(now, 40 * MIN), now);
    expect(presets.map((p) => p.label)).toEqual([
      expect.stringMatching(/^Game time · /),
      '30 min before',
    ]);
    // Game in 10 min: only the game time survives.
    const soon = computeGameTimePresets(at(now, 10 * MIN), now);
    expect(soon.map((p) => p.label)).toEqual([expect.stringMatching(/^Game time · /)]);
  });

  it('keeps the game chip inside the grace window and drops it beyond', () => {
    expect(computeGameTimePresets(at(now, -(PAST_GRACE_MS - MIN)), now)).toHaveLength(1);
    // Game started 20 minutes ago: nothing; the caller falls back to the
    // general presets so starts_at is never in the past.
    expect(computeGameTimePresets(at(now, -20 * MIN), now)).toEqual([]);
  });

  it('returns nothing for TBD or unparseable game times', () => {
    expect(computeGameTimePresets(null, now)).toEqual([]);
    expect(computeGameTimePresets(undefined, now)).toEqual([]);
    expect(computeGameTimePresets('', now)).toEqual([]);
    expect(computeGameTimePresets('not-a-date', now)).toEqual([]);
  });

  it('labels a game on another local day with its weekday (date crossing)', () => {
    // 00:05 local tomorrow.
    const tomorrow = new Date(2026, 8, 25, 0, 5, 0, 0);
    const label = formatGameTimeChip(tomorrow.toISOString(), now);
    const weekday = tomorrow.toLocaleDateString('en-US', { weekday: 'short' });
    expect(label).toBe(`Game time · ${weekday} 12:05 AM`);
    // Same day: no weekday.
    const later = new Date(2026, 8, 24, 11, 35, 0, 0);
    expect(formatGameTimeChip(later.toISOString(), now)).toBe('Game time · 11:35 AM');
  });

  it('is DST-safe: offsets are exact instants across a US fall-back night', () => {
    // 2026-11-01 is the US DST end. A 1:30 AM game on that morning (local)
    // still gets chips exactly 30 and 60 minutes earlier as instants.
    const dstNow = new Date(2026, 9, 31, 22, 0, 0, 0);
    const game = new Date(2026, 10, 1, 1, 30, 0, 0).toISOString();
    const presets = computeGameTimePresets(game, dstNow);
    expect(presets).toHaveLength(3);
    expect(new Date(game).getTime() - new Date(presets[1]!.value).getTime()).toBe(30 * MIN);
    expect(new Date(game).getTime() - new Date(presets[2]!.value).getTime()).toBe(60 * MIN);
  });
});
