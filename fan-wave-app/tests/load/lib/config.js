/**
 * tests/load/lib/config.js — shared configuration for the k6 load scripts.
 *
 * Reads (all via k6 __ENV):
 *   SUPABASE_URL        https://<staging-ref>.supabase.co   (REQUIRED, never prod)
 *   SUPABASE_ANON_KEY   the staging project's anon key       (REQUIRED)
 *   LOAD_USERS_FILE     JSON array of {email,password}; default ../users.json
 *                       (relative to this lib/ directory, i.e. tests/load/users.json;
 *                       pass an ABSOLUTE path when overriding)
 *   LOAD_TOKENS_FILE    optional JSON array of {email,jwt,userId} pre-minted by
 *                       scripts/load/mint-tokens.mjs. When set, scripts skip
 *                       setup() minting and read tokens from a SharedArray.
 *   STAGE               1..5 -> VU targets 100 / 500 / 1000 / 5000 / 10000
 *
 * HARD GUARD: this module throws in the init context if SUPABASE_URL is
 * empty, points at the production project (ref fwlfiejvxmslkpoojggs), or if
 * the key handed in as the anon key is actually a service_role key. Every
 * script imports this module, so no script can start against prod.
 */

// ─── Production guard ─────────────────────────────────────────────────

export const PROD_PROJECT_REF = 'fwlfiejvxmslkpoojggs';

// Legacy dev project (azkmymxdjylmkytrvyfn) is NOT blocked here on purpose:
// the owner may repurpose or delete it. Only prod is hard-blocked.

function fail(msg) {
  throw new Error(`[load-config] ${msg}`);
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // k6 exposes atob via the encoding module only; a hand-rolled decoder
    // avoids importing k6/encoding just for this guard.
    return JSON.parse(base64Decode(padded));
  } catch (_e) {
    return null;
  }
}

function base64Decode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '=') break;
    const v = chars.indexOf(c);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

export function assertSafeTarget(url, anonKey) {
  if (!url || !String(url).trim()) {
    fail('SUPABASE_URL is empty. Point it at the STAGING project (never production).');
  }
  if (String(url).includes(PROD_PROJECT_REF)) {
    fail(
      `REFUSING TO RUN: SUPABASE_URL contains the PRODUCTION project ref ` +
        `(${PROD_PROJECT_REF}). Load tests may only target a staging project.`
    );
  }
  if (!/^https:\/\//i.test(String(url))) {
    fail(`SUPABASE_URL must be an https:// URL, got "${url}".`);
  }
  if (!anonKey || !String(anonKey).trim()) {
    fail('SUPABASE_ANON_KEY is empty.');
  }
  const payload = decodeJwtPayload(anonKey);
  if (payload && payload.role === 'service_role') {
    fail('SUPABASE_ANON_KEY is a service_role key. Load tests must use the anon key.');
  }
  if (payload && payload.ref && payload.ref === PROD_PROJECT_REF) {
    fail('SUPABASE_ANON_KEY belongs to the PRODUCTION project. Refusing.');
  }
}

// ─── Environment ──────────────────────────────────────────────────────

export const SUPABASE_URL = String(__ENV.SUPABASE_URL || '').replace(/\/+$/, '');
export const SUPABASE_ANON_KEY = String(__ENV.SUPABASE_ANON_KEY || '');
export const LOAD_USERS_FILE = __ENV.LOAD_USERS_FILE || '../users.json';
export const LOAD_TOKENS_FILE = __ENV.LOAD_TOKENS_FILE || '';

// Runs in the init context of every VU, so a bad target aborts before any
// request is made.
assertSafeTarget(SUPABASE_URL, SUPABASE_ANON_KEY);

export const REST_URL = `${SUPABASE_URL}/rest/v1`;
export const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
// Realtime endpoint — UNVERIFIED against a live project; see realtime-ws.js.
export const REALTIME_WS_URL =
  SUPABASE_URL.replace(/^https:\/\//i, 'wss://') + '/realtime/v1/websocket';

// ─── Stage profiles ───────────────────────────────────────────────────
//
// The review's staged rollout: never skip a stage, never proceed past a
// stage that fails its thresholds (see README "Stage gate rules").
//
//   vus       peak concurrent VUs (one VU ~ one signed-in app session)
//   ramp      time to reach the peak
//   hold      time at the peak
//   rampDown  time back to zero
//
// Stage 5 (10 000 VUs) exceeds what a single laptop can generate for the
// Realtime scenario (10 000 open sockets) and is close to the ceiling for
// HTTP on a 16 GB machine; run it from a cloud VM or split across two
// machines with --execution-segment (README).

export const STAGE_PROFILES = {
  1: { vus: 100, ramp: '1m', hold: '3m', rampDown: '30s' },
  2: { vus: 500, ramp: '2m', hold: '5m', rampDown: '1m' },
  3: { vus: 1000, ramp: '3m', hold: '5m', rampDown: '1m' },
  4: { vus: 5000, ramp: '5m', hold: '5m', rampDown: '2m' },
  5: { vus: 10000, ramp: '5m', hold: '10m', rampDown: '2m' },
};

export const STAGE = (() => {
  const raw = String(__ENV.STAGE || '1').trim();
  const n = Number(raw);
  if (!STAGE_PROFILES[n]) {
    fail(`STAGE must be 1..5 (got "${raw}"). 1=100 VUs, 2=500, 3=1000, 4=5000, 5=10000.`);
  }
  return n;
})();

export const PROFILE = STAGE_PROFILES[STAGE];

/** ramping-vus stages for the selected profile (optionally capped). */
export function rampingStages(capVus) {
  const target = capVus ? Math.min(PROFILE.vus, capVus) : PROFILE.vus;
  return [
    { duration: PROFILE.ramp, target },
    { duration: PROFILE.hold, target },
    { duration: PROFILE.rampDown, target: 0 },
  ];
}

/** Total wall-clock seconds of the ramp+hold+rampDown profile. */
export function profileDurationSeconds() {
  return [PROFILE.ramp, PROFILE.hold, PROFILE.rampDown]
    .map(parseDurationSeconds)
    .reduce((a, b) => a + b, 0);
}

export function parseDurationSeconds(d) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(d).trim());
  if (!m) fail(`Bad duration "${d}"`);
  const v = Number(m[1]);
  return { ms: v / 1000, s: v, m: v * 60, h: v * 3600 }[m[2]];
}

// ─── Shared thresholds (from the scalability review) ──────────────────
//
//   feed p95      < 800 ms   -> feed_latency (games + parties + groups + clips)
//   chat p95      < 1 s      -> chat_send
//   chat p99      < 3 s      -> chat_send
//   error rate    < 1 %      -> errors (Rate; 429/403-rate-limit are NOT
//                               counted as errors, they have their own metric)
//   stage 5 only: connection error rate < 0.5 % -> ws_connect_errors
//
// Thresholds are named per custom metric so a script can pick the ones it
// emits; k6 aborts a threshold on a metric that was never emitted.

export const THRESHOLDS = {
  feed: { feed_latency: ['p(95)<800'] },
  games: { games_latency: ['p(95)<800'] },
  parties: { parties_latency: ['p(95)<800'] },
  groups: { groups_latency: ['p(95)<800'] },
  clips: { clips_latency: ['p(95)<800'] },
  chat: { chat_send: ['p(95)<1000', 'p(99)<3000'] },
  rsvp: { rsvp_latency: ['p(95)<1000'] },
  errors: { errors: ['rate<0.01'] },
  // The review states the connection-error gate for stage 5; applying the
  // same number at every stage surfaces a regression early rather than at 10k.
  wsConnect: { ws_connect_errors: ['rate<0.005'] },
  wsJoin: { ws_join_ok: ['rate>0.99'] },
  rejoin: { ws_rejoin_within_10s: ['rate>=0.99'] },
};

export function mergeThresholds(...groups) {
  return Object.assign({}, ...groups);
}

// ─── Scenario knobs ───────────────────────────────────────────────────

export const HOME_CITY = __ENV.HOME_CITY || 'Chicago';
export const PARTY_ID = __ENV.PARTY_ID || '';
export const CHAT_ROOM_ID = __ENV.CHAT_ROOM_ID || '';

/** k6 `options.summaryTrendStats` we want everywhere. */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];
