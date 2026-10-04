// Build 33 UAT finding 5: catch-up timeouts during an outage must not be
// error-level Sentry events; with the socket connected they still are.
import { isTransientNetworkError, shouldReportCatchUpError } from '../lib/transientNetworkError';

describe('isTransientNetworkError', () => {
  it('recognises the withTimeout rejection and the common native network errors', () => {
    expect(isTransientNetworkError(new Error('Timeout after 8000ms'))).toBe(true);
    expect(isTransientNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isTransientNetworkError(new Error('Failed to connect to fwlfiejvxmslkpoojggs.supabase.co/104.18.38.10:443'))).toBe(true);
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
    expect(isTransientNetworkError({ message: 'Unable to resolve host "x.supabase.co"' })).toBe(true);
  });

  it('does not match server or application errors', () => {
    expect(isTransientNetworkError(new Error('permission denied for table messages'))).toBe(false);
    expect(isTransientNetworkError(new Error('JSON Parse error: Unexpected token'))).toBe(false);
    expect(isTransientNetworkError({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(42)).toBe(false);
  });
});

describe('shouldReportCatchUpError', () => {
  const timeout = new Error('Timeout after 8000ms');
  const serverError = new Error('permission denied for table messages');

  it('is a breadcrumb, not an event, when the network is down (airplane mode, tunnel)', () => {
    expect(shouldReportCatchUpError(timeout, false)).toBe(false);
  });

  it('is still an error when the socket is connected but the fetch timed out', () => {
    expect(shouldReportCatchUpError(timeout, true)).toBe(true);
  });

  it('always reports non-network failures, online or not', () => {
    expect(shouldReportCatchUpError(serverError, false)).toBe(true);
    expect(shouldReportCatchUpError(serverError, true)).toBe(true);
  });
});
