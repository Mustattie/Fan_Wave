// A fetch wrapper for the Supabase client that keeps a 429 on the auth
// token endpoint from destroying the session.
//
// Why this exists (Phase 1, 2026-09-16 scalability review):
//
//   auth-js treats only network failures and 502/503/504 as retryable
//   (lib/fetch.js NETWORK_ERROR_CODES). Every other non-2xx on
//   /auth/v1/token -- including a 429 from GoTrue's per-IP refresh limit
//   of 150 per 5 minutes -- is an AuthApiError, and _callRefreshToken
//   answers a non-retryable error with _removeSession(): the session is
//   deleted from AsyncStorage and SIGNED_OUT fires. On home Wi-Fi that
//   never happens. Behind a stadium NAT or carrier CGNAT, where thousands
//   of phones share one IP, it is a mass logout at kickoff.
//
//   A 429 means "not now", not "this session is invalid". So on the token
//   endpoint we retry with backoff (honouring Retry-After), and if the
//   limit is still in force we hand auth-js a 503 instead. auth-js then
//   raises AuthRetryableFetchError, keeps the session, and its auto-refresh
//   tick tries again later. PostgREST calls made with the expired token
//   will 401 until that succeeds, which is the correct failure mode.
//
//   Every non-2xx from the auth service is also recorded (status + error
//   code only -- never a body, header or token) so an unexpected SIGNED_OUT
//   can say what preceded it. See lib/authTelemetry.ts.

import { recordAuthFailure } from './authTelemetry';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ResilientFetchOptions {
  /** Maximum extra attempts after the first 429. */
  maxRetries?: number;
  /** Cap on a single wait, in ms. Retry-After above this is clamped. */
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
  /** Injectable for tests: [0, 1). Spreads the backoff over [d, 1.5d). */
  random?: () => number;
}

const DEFAULTS: Required<ResilientFetchOptions> = {
  maxRetries: 3,
  maxDelayMs: 10_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  random: () => Math.random(),
};

const AUTH_PATH = '/auth/v1/';
const TOKEN_PATH = '/auth/v1/token';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** 'token', 'user', 'logout', ... -- the path segment after /auth/v1/. */
export function authEndpointOf(url: string): string | null {
  const i = url.indexOf(AUTH_PATH);
  if (i === -1) return null;
  const rest = url.slice(i + AUTH_PATH.length);
  const seg = rest.split(/[/?#]/)[0];
  return seg || null;
}

function retryAfterMs(res: Response, maxDelayMs: number): number | null {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.min(secs * 1000, maxDelayMs);
}

/**
 * Pull GoTrue's error code out of a failed auth response without keeping
 * the body. Reads a clone so the caller still gets the original stream.
 */
async function extractErrorCode(res: Response): Promise<string | null> {
  try {
    const json = await res.clone().json();
    const code = json?.error_code ?? json?.code ?? json?.error;
    return typeof code === 'string' ? code.slice(0, 64) : null;
  } catch {
    return null;
  }
}

function rateLimitedAsRetryable(): Response {
  return new Response(
    JSON.stringify({
      code: 503,
      error_code: 'over_request_rate_limit',
      msg: 'Auth rate limit still in force after retries; session kept.',
    }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function createResilientFetch(
  baseFetch: FetchLike,
  options: ResilientFetchOptions = {},
): FetchLike {
  const opts = { ...DEFAULTS, ...options };

  return async (input, init) => {
    const url = urlOf(input);
    const endpoint = authEndpointOf(url);

    // Not an auth call: pass straight through. PostgREST, Storage and
    // Realtime have their own semantics and nothing here applies to them.
    if (!endpoint) return baseFetch(input, init);

    const isTokenEndpoint = url.includes(TOKEN_PATH);
    let attempt = 0;
    let res = await baseFetch(input, init);

    while (res.status === 429 && isTokenEndpoint && attempt < opts.maxRetries) {
      // P2.12 (2026-09-25): thousands of phones behind one venue NAT are
      // rate-limited together and used to retry on the same 1/2/4 s
      // ladder, re-colliding every step. Retry-After is honoured as given
      // (the server chose it); the fallback backoff is jittered.
      const base = retryAfterMs(res, opts.maxDelayMs);
      const wait =
        base ?? Math.min(Math.floor(1000 * 2 ** attempt * (1 + opts.random() * 0.5)), opts.maxDelayMs);
      recordAuthFailure({ endpoint, status: 429, errorCode: 'over_request_rate_limit' });
      attempt += 1;
      await opts.sleep(wait);
      res = await baseFetch(input, init);
    }

    if (res.status === 429 && isTokenEndpoint) {
      recordAuthFailure({ endpoint, status: 429, errorCode: 'over_request_rate_limit_final' });
      return rateLimitedAsRetryable();
    }

    if (!res.ok) {
      recordAuthFailure({
        endpoint,
        status: res.status,
        errorCode: await extractErrorCode(res),
      });
    }

    return res;
  };
}
