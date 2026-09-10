import {
  getSportEmoji,
  getSportColor,
  formatRelativeTime,
  formatFullDate,
  mapGameToDisplay,
  mapGameRealtimePatch,
} from '../lib/mappers';

describe('getSportEmoji', () => {
  it('returns correct emoji for known sports', () => {
    expect(getSportEmoji('nfl')).toBeDefined();
    expect(getSportEmoji('nba')).toBeDefined();
    expect(getSportEmoji('soccer')).toBeDefined();
  });

  it('returns default trophy for null/undefined', () => {
    expect(getSportEmoji(null)).toBe('🏆');
    expect(getSportEmoji(undefined)).toBe('🏆');
    expect(getSportEmoji('')).toBe('🏆');
  });
});

describe('getSportColor', () => {
  it('returns a hex color string for known sports', () => {
    const color = getSportColor('nfl');
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('returns a fallback color for unknown sport', () => {
    const color = getSportColor('curling');
    expect(typeof color).toBe('string');
  });
});

describe('formatRelativeTime', () => {
  it('returns "Just now" for recent times', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('Just now');
  });

  it('returns minutes ago for times within the hour', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatRelativeTime(tenMinAgo)).toBe('10m ago');
  });

  it('returns hours ago for times within the day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
  });

  it('returns weekday and time for dates within the past week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toMatch(
      /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) · \d{1,2}:\d{2}\s?(AM|PM)$/
    );
  });
});

describe('formatFullDate', () => {
  it('returns a human-readable full date', () => {
    const result = formatFullDate('2026-06-11T15:00:00Z');
    expect(result).toContain('June');
    expect(result).toContain('11');
    expect(result).toContain('2026');
  });
});


// ---------------------------------------------------------------------------
// mapGameRealtimePatch — regression cover for iOS UAT UX-21.
//
// Game Day patched its list with `mapGameToDisplay(payload.new)`. A
// postgres_changes payload is the FLAT games row: no PostgREST embed, so no
// home_team / away_team. The full mapper happily produced a GameDisplay whose
// teams were the "Home"/"Away" fallback, and that object replaced the real
// one — every game ESPN touched lost its team names and logos.
//
// The first test pins the trap itself, so the shape of the bug stays
// documented; the rest pin the fix.
// ---------------------------------------------------------------------------
describe('mapGameRealtimePatch', () => {
  const realtimeRow = {
    id: 'game-1',
    sport_id: 'mls',
    status: 'in',
    home_score: 2,
    away_score: 1,
    scheduled_at: '2026-09-09T23:30:00.000Z',
    metadata: { period: 2, display_clock: "67'", detail: '2nd Half' },
  };

  it('the full mapper on a realtime row is exactly the trap (why this exists)', () => {
    const wrong = mapGameToDisplay(realtimeRow);
    expect(wrong.homeTeam.name).toBe('Home');
    expect(wrong.awayTeam.name).toBe('Away');
    expect(wrong.homeTeam.logoUrl).toBeNull();
  });

  it('never returns team, league or sport fields', () => {
    const patch = mapGameRealtimePatch(realtimeRow);
    expect(patch).not.toHaveProperty('homeTeam');
    expect(patch).not.toHaveProperty('awayTeam');
    expect(patch).not.toHaveProperty('league');
    expect(patch).not.toHaveProperty('sport');
  });

  it('carries the live fields the realtime row can answer for', () => {
    const patch = mapGameRealtimePatch(realtimeRow);
    expect(patch.homeScore).toBe(2);
    expect(patch.awayScore).toBe(1);
    expect(patch.status).toBe('live');
    expect(patch.period).toBe(2);
    expect(patch.displayClock).toBe("67'");
    expect(patch.detail).toBe('2nd Half');
  });

  it('translates ESPN status codes the same way the full mapper does', () => {
    expect(mapGameRealtimePatch({ ...realtimeRow, status: 'post' }).status).toBe('final');
    expect(mapGameRealtimePatch({ ...realtimeRow, status: 'scheduled' }).status).toBe('scheduled');
  });

  it('spreading the patch over a mapped game preserves the teams', () => {
    const mapped = mapGameToDisplay({
      id: 'game-1',
      sport_id: 'mls',
      status: 'scheduled',
      scheduled_at: '2026-09-09T23:30:00.000Z',
      home_team: { name: 'Toronto FC', logo_url: 'https://x/tor.png' },
      away_team: { name: 'Nashville SC', logo_url: 'https://x/nsh.png' },
    });
    expect(mapped.homeTeam.name).toBe('Toronto FC');

    const merged = { ...mapped, ...mapGameRealtimePatch(realtimeRow) };
    // The whole point: a live update must not cost the card its teams.
    expect(merged.homeTeam.name).toBe('Toronto FC');
    expect(merged.awayTeam.name).toBe('Nashville SC');
    expect(merged.homeTeam.logoUrl).toBe('https://x/tor.png');
    // ...while still delivering the new score and state.
    expect(merged.homeScore).toBe(2);
    expect(merged.status).toBe('live');
  });

  it('tolerates a row with no metadata', () => {
    const patch = mapGameRealtimePatch({ id: 'g', status: 'in' });
    expect(patch.period).toBeNull();
    expect(patch.displayClock).toBeNull();
    expect(patch.status).toBe('live');
  });
});
