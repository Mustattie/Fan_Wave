// Build 33 UAT finding 5 (2026-10-03): during airplane-mode cycles the
// chat catch-up fetch (fan-group screen, withTimeout 8 s) rejected six
// times in four minutes and each rejection became an error-level Sentry
// event ("Error: Timeout after 8000ms", source fan-group:catchUpMessages).
// A timeout while the realtime socket is down is the outage itself, not a
// defect; at launch every user walking through a tunnel would feed the
// error-volume and users-hit monitors with it. A timeout with the socket
// connected is still worth an error: the server is reachable and did not
// answer.

const TRANSIENT_PATTERNS = [
  /^timeout after \d+ms/i,
  /network request failed/i,
  /failed to connect/i,
  /fetch failed/i,
  /unable to resolve host/i,
  /software caused connection abort/i,
  /connection reset/i,
  /socket is closed/i,
];

/** The error names an outage of the device's network, not a server fault. */
export function isTransientNetworkError(e: unknown): boolean {
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : (e as { message?: unknown } | null)?.message;
  if (typeof msg !== 'string') return false;
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError') return true;
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

/**
 * Report to Sentry only when the failure can mean something: either it is
 * not a transient network error, or it is one but the realtime socket is
 * connected (so the network is up and the server did not answer in time).
 * A transient error while the socket is down is a breadcrumb, not an event.
 */
export function shouldReportCatchUpError(e: unknown, socketConnected: boolean): boolean {
  if (!isTransientNetworkError(e)) return true;
  return socketConnected;
}
