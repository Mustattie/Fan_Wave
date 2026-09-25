import { createResilientFetch, authEndpointOf } from '../lib/authFetch';
import { getLastAuthFailure, _resetAuthTelemetryForTests } from '../lib/authTelemetry';

const TOKEN_URL = 'https://x.supabase.co/auth/v1/token?grant_type=refresh_token';
const USER_URL = 'https://x.supabase.co/auth/v1/user';
const REST_URL = 'https://x.supabase.co/rest/v1/games?select=*';

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('authEndpointOf', () => {
  it('names the auth endpoint', () => {
    expect(authEndpointOf(TOKEN_URL)).toBe('token');
    expect(authEndpointOf(USER_URL)).toBe('user');
    expect(authEndpointOf(REST_URL)).toBeNull();
  });
});

describe('createResilientFetch', () => {
  const sleep = jest.fn(() => Promise.resolve());

  beforeEach(() => {
    sleep.mockClear();
    _resetAuthTelemetryForTests();
  });

  it('passes non-auth requests straight through, 429 included', async () => {
    const base = jest.fn(async () => res(429));
    const f = createResilientFetch(base, { sleep });
    const r = await f(REST_URL);
    expect(r.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(1);
    expect(getLastAuthFailure()).toBeNull();
  });

  it('retries a 429 on the token endpoint and returns the eventual success', async () => {
    const base = jest
      .fn<Promise<Response>, any[]>()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200, { access_token: 'x' }));
    const f = createResilientFetch(base, { sleep, maxRetries: 3, random: () => 0 });
    const r = await f(TOKEN_URL, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(3);
    // First wait honours Retry-After (2 s), second falls back to backoff.
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('jitters the fallback backoff over [d, 1.5d) but never Retry-After (P2.12)', async () => {
    const base = jest
      .fn<Promise<Response>, any[]>()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200, { access_token: 'x' }));
    const f = createResilientFetch(base, { sleep, maxRetries: 3, random: () => 0.999 });
    await f(TOKEN_URL, { method: 'POST' });
    expect(sleep).toHaveBeenNthCalledWith(1, 2000); // server-chosen, as given
    expect(sleep).toHaveBeenNthCalledWith(2, Math.floor(2000 * 1.4995)); // attempt 1: 2 s base
    expect(sleep).toHaveBeenNthCalledWith(3, Math.floor(4000 * 1.4995)); // attempt 2: 4 s base
  });

  it('turns a persistent 429 into a 503 so auth-js keeps the session', async () => {
    const base = jest.fn(async () => res(429));
    const f = createResilientFetch(base, { sleep, maxRetries: 2 });
    const r = await f(TOKEN_URL, { method: 'POST' });
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error_code).toBe('over_request_rate_limit');
    expect(base).toHaveBeenCalledTimes(3);
    expect(getLastAuthFailure()).toMatchObject({
      endpoint: 'token',
      status: 429,
      errorCode: 'over_request_rate_limit_final',
    });
  });

  it('records other auth failures with the error code and no body', async () => {
    const base = jest.fn(async () =>
      res(400, { error_code: 'refresh_token_already_used', msg: 'secret-ish detail' }),
    );
    const f = createResilientFetch(base, { sleep });
    const r = await f(TOKEN_URL, { method: 'POST' });
    expect(r.status).toBe(400);
    // The original response is still readable by the caller.
    expect((await r.json()).msg).toBe('secret-ish detail');
    const failure = getLastAuthFailure();
    expect(failure).toMatchObject({ endpoint: 'token', status: 400, errorCode: 'refresh_token_already_used' });
    expect(JSON.stringify(failure)).not.toContain('secret-ish');
  });

  it('does not retry a 429 on non-token auth endpoints', async () => {
    const base = jest.fn(async () => res(429));
    const f = createResilientFetch(base, { sleep });
    const r = await f(USER_URL);
    expect(r.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(1);
  });
});
