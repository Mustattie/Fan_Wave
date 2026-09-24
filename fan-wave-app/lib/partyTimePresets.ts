// Start-time chips for the Create Watch Party wizard when a game is linked.
//
// v9.5.19 (Build 29 UAT): the wizard seeded its start time from the fixed
// "Tonight 7PM" list at mount and never read the linked game, so a party
// for an 11:35 AM game defaulted to 7:00 PM. When the linked game has a
// scheduled_at, the chips are derived from it instead.
//
// Everything here works on instants (epoch ms). games.scheduled_at is a
// TIMESTAMPTZ delivered as a UTC ISO string; watch_parties.starts_at is
// stored the same way and rendered in the device timezone everywhere in
// the app. Subtracting 30/60 minutes from an instant is DST-safe; no
// wall-clock arithmetic happens in this module.

export interface TimePreset {
  label: string;
  value: string;
}

/**
 * Same grace the general presets use (create-watch-party.tsx
 * computeTimePresets): a chip whose instant is more than 15 minutes in the
 * past is dropped, because every list query is `.gt('starts_at', now())`
 * and a party created in the past vanishes from the tab (v8.5 P0).
 */
export const PAST_GRACE_MS = 15 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Game time · 11:35 AM" for a game today; "Game time · Sat 11:35 AM"
 * when the game falls on another local day, so a 12:05 AM game that has
 * crossed midnight is not mistaken for tonight. Device timezone, like
 * formatGameTime in lib/mappers.ts.
 */
export function formatGameTimeChip(scheduledAt: string, now: Date = new Date()): string {
  const d = new Date(scheduledAt);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(d, now)) return `Game time · ${time}`;
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `Game time · ${day} ${time}`;
}

/**
 * Chips for a linked game: the game time itself (the default), then
 * 30 minutes and 1 hour before it, each dropped if already past the
 * grace cutoff. Returns [] when there is no usable game time -- a TBD
 * game (scheduledAt null), an unparseable value, or a game that has
 * already started -- and the caller falls back to the general presets.
 */
export function computeGameTimePresets(
  scheduledAt: string | null | undefined,
  now: Date = new Date(),
): TimePreset[] {
  if (!scheduledAt) return [];
  const gameMs = new Date(scheduledAt).getTime();
  if (!Number.isFinite(gameMs)) return [];

  const cutoff = now.getTime() - PAST_GRACE_MS;
  if (gameMs <= cutoff) return [];

  const presets: TimePreset[] = [
    { label: formatGameTimeChip(scheduledAt, now), value: new Date(gameMs).toISOString() },
  ];
  const before = [
    { label: '30 min before', minutes: 30 },
    { label: '1 hr before', minutes: 60 },
  ];
  for (const b of before) {
    const ms = gameMs - b.minutes * MINUTE_MS;
    if (ms > cutoff) presets.push({ label: b.label, value: new Date(ms).toISOString() });
  }
  return presets;
}
