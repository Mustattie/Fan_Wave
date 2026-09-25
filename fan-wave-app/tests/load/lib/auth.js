/**
 * tests/load/lib/auth.js — per-VU signed-in sessions for the k6 scripts.
 *
 * Every scenario runs as a real `authenticated` user because the app's
 * RLS policies (watch_parties, browse_public_groups, messages, rsvp RPC…)
 * return empty sets or 42501 under the anon key — the pre-v9.5 scripts
 * measured nothing but the auth layer.
 *
 * Two ways to get tokens, in order of preference:
 *
 *   1. LOAD_TOKENS_FILE  (pre-minted by scripts/load/mint-tokens.mjs)
 *      [{ email, jwt, userId, mintedAt }] — loaded once into a SharedArray.
 *      Use this for stage >= 2: minting thousands of sessions inside k6's
 *      setup() would trip the auth sign-in rate bucket and skew the run.
 *
 *   2. users.json  (written by scripts/load/seed-users.mjs)
 *      [{ email, password }] — setup() mints one JWT per user with the
 *      password grant, paced at MINT_RPS (default 5/s), honouring
 *      Retry-After on 429. OK for stage 1 (100 users ≈ 20 s).
 *
 * JWTs on this project expire after 3600 s (jwt_exp). Stage 5 lasts 17 min,
 * so tokens minted less than ~40 min before the run stay valid throughout;
 * `assertTokensFresh` aborts the run otherwise.
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import {
  AUTH_URL,
  SUPABASE_ANON_KEY,
  LOAD_USERS_FILE,
  LOAD_TOKENS_FILE,
  PROFILE,
  profileDurationSeconds,
} from './config.js';

export const JWT_TTL_SECONDS = 3600;
export const MINT_RPS = Number(__ENV.MINT_RPS || 5);

// ─── Init-context loads (run once per k6 process) ─────────────────────

function loadJson(path) {
  const raw = open(path);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`[load-auth] ${path} must be a JSON array`);
  return parsed;
}

export const PREMINTED = LOAD_TOKENS_FILE
  ? new SharedArray('load-tokens', () => loadJson(LOAD_TOKENS_FILE))
  : null;

export const USERS = !LOAD_TOKENS_FILE
  ? new SharedArray('load-users', () => loadJson(LOAD_USERS_FILE))
  : null;

// ─── Minting (setup context only) ─────────────────────────────────────

export function mintToken(email, password) {
  const res = http.post(
    `${AUTH_URL}/token?grant_type=password`,
    JSON.stringify({ email, password }),
    {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      tags: { name: 'auth_password_grant' },
    }
  );
  if (res.status === 429) {
    const retry = Number(res.headers['Retry-After'] || 10);
    return { retryAfter: Math.min(Math.max(retry, 1), 60) };
  }
  if (res.status !== 200) {
    return { error: `status ${res.status}: ${String(res.body).slice(0, 200)}` };
  }
  const body = res.json();
  return {
    jwt: body.access_token,
    userId: body.user && body.user.id,
    mintedAt: new Date().toISOString(),
  };
}

/**
 * Call from a script's setup(). Returns [{email, jwt, userId, mintedAt}].
 * Mints only as many sessions as the stage needs (PROFILE.vus), cycling the
 * user list if it is shorter than that.
 */
export function acquireSessions(needed = PROFILE.vus) {
  if (PREMINTED) {
    const sessions = PREMINTED.slice(0, Math.max(1, Math.min(needed, PREMINTED.length)));
    assertTokensFresh(sessions);
    if (sessions.length < needed) {
      console.warn(
        `[load-auth] ${sessions.length} pre-minted sessions for ${needed} VUs; VUs will share sessions.`
      );
    }
    return sessions;
  }
  if (!USERS || USERS.length === 0) {
    throw new Error(
      '[load-auth] no users. Run `node scripts/load/seed-users.mjs --count N` against staging first.'
    );
  }
  const count = Math.min(needed, USERS.length);
  if (count < needed) {
    console.warn(`[load-auth] ${USERS.length} users for ${needed} VUs; VUs will share sessions.`);
  }
  const sessions = [];
  const spacing = 1 / MINT_RPS;
  for (let i = 0; i < count; i++) {
    const u = USERS[i];
    let attempt = 0;
    for (;;) {
      const r = mintToken(u.email, u.password);
      if (r.jwt) {
        sessions.push({ email: u.email, jwt: r.jwt, userId: r.userId, mintedAt: r.mintedAt });
        break;
      }
      if (r.retryAfter && attempt < 5) {
        attempt += 1;
        console.warn(`[load-auth] 429 minting ${u.email}; sleeping ${r.retryAfter}s`);
        sleep(r.retryAfter);
        continue;
      }
      throw new Error(`[load-auth] could not mint ${u.email}: ${r.error || 'rate limited'}`);
    }
    sleep(spacing);
  }
  return sessions;
}

export function assertTokensFresh(sessions) {
  const runSeconds = profileDurationSeconds();
  const now = Date.now();
  for (const s of sessions) {
    if (!s.mintedAt) continue;
    const age = (now - Date.parse(s.mintedAt)) / 1000;
    if (age + runSeconds > JWT_TTL_SECONDS - 120) {
      throw new Error(
        `[load-auth] token for ${s.email} is ${Math.round(age)}s old; it would expire during a ` +
          `${runSeconds}s run (jwt_exp ${JWT_TTL_SECONDS}s). Re-run scripts/load/mint-tokens.mjs.`
      );
    }
  }
}

/** Deterministic VU → session mapping (VU ids are 1-based). */
export function sessionForVu(sessions) {
  return sessions[(__VU - 1) % sessions.length];
}

export function authHeaders(jwt) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };
}
