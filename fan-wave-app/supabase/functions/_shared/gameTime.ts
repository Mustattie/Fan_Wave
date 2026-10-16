/** ESPN placeholder dates must never become advertised kickoff times. */
export function scheduledGameTime(event: { date?: unknown }, competition: { date?: unknown; timeValid?: boolean }): string | null {
  if (competition.timeValid === false) return null;
  const candidate = competition.date ?? event.date;
  if (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate))) return null;
  return candidate;
}

/** Missing provider data cannot erase a previously known time. Explicit TBD can. */
export function gameTimeForWrite(incoming: string | null, explicitlyUnknown: boolean, existing: unknown): string | null {
  if (incoming !== null) return incoming;
  if (explicitlyUnknown) return null;
  return typeof existing === 'string' ? existing : null;
}
