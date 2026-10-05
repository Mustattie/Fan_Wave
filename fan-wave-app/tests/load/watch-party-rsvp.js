/**
 * k6 — RSVP burst on one watch party (row lock + capacity check).
 *
 * rsvp_to_watch_party(p_party_id UUID, p_status TEXT) is SECURITY DEFINER and
 * keyed on auth.uid(), so every VU runs as its own signed-in user. Every VU
 * performs exactly ONE going → none cycle: the "going" calls land on the
 * party row close together, exercising the row lock and the capacity check;
 * the cancel a moment later exercises the delete-on-cancel path (mig 073)
 * and leaves the party's rsvp_count where it started.
 *
 * Arrival model. The committed ramping-vus shape reached the profile's peak
 * in a third of its ramp (shrink(PROFILE.ramp, 3)). per-vu-iterations has no
 * ramp of its own, so each VU reproduces that shape by sleeping before its
 * "going" call: VU n (1-based, unique) starts at (n - 1) * window / vus
 * seconds, i.e. the VUs are spread linearly across the window:
 *
 *   baseline   50 VUs over 20 s   (ramp 1m  / 3)
 *   campus    300 VUs over 60 s   (ramp 3m  / 3)
 *   spike     600 VUs over 10 s   (ramp 10s / 3, floored at 10 s)
 *
 * The window is derived from the profile only; there is no env override
 * that can widen it, so a passing gate run always ran the same shape.
 * `spike` is the schema stress gate: 600 arrivals in 10 s on one row.
 *
 * Why one cycle and not a loop. Migration 103 caps watch_party_rsvps
 * INSERTs at 20 per user per DAY on the free tier (100/day paid; window
 * 86 400 s), raised as PT429 → HTTP 429. A looping going → none toggle
 * spends that budget in minutes and the rest of the run is 429 noise
 * (seen on staging at baseline: 1 000 successes = 50 users × 20, then
 * 2 138 429s). One cycle per VU costs each load user ONE of its 20 daily
 * INSERTs, so a 429 here is a real failure — a spent budget or a wrong
 * ceiling — and is gated as such. Repeat runs need fresh or rotated users
 * (re-seed, or point LOAD_USERS_FILE / LOAD_TOKENS_FILE at a different
 * pool); the same pool cannot be reused more than 20 times in a day.
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=baseline \
 *          --env PARTY_ID=<uuid of a staging party with capacity >= VUs, or NULL> \
 *          tests/load/watch-party-rsvp.js
 *
 * Gates: rsvp p95 < 1 s; rsvp_ok == 100 % (every going AND every cancel must
 * be 2xx — 429, capacity-full P0001, 5xx all fail the run); errors < 1 %.
 */
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
  REST_URL,
  PARTY_ID,
  STAGE,
  PROFILE,
  THRESHOLDS,
  mergeThresholds,
  parseDurationSeconds,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu, authHeaders } from './lib/auth.js';
import { rpc, think } from './lib/http.js';

const rsvpLatency = new Trend('rsvp_latency', true);
// 1 for a 2xx going/cancel, 0 for anything else. lib/http.js files 429s under
// rate_limited (not errors) for the other scripts; for RSVP a 429 is a failed
// RSVP, so this scenario-local Rate gates on strict 2xx regardless of status.
const rsvpOk = new Rate('rsvp_ok');

if (!PARTY_ID) {
  throw new Error('[watch-party-rsvp] PARTY_ID is required (a watch_parties.id on staging).');
}

/**
 * A burst is sharper than the feed profile: the committed ramping-vus
 * scenario reached the peak in a third of the stage's ramp. Kept verbatim
 * so the arrival window is the same one the gates were written against.
 */
function shrink(duration, factor) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) return duration;
  const seconds = Number(m[1]) * (m[2] === 'm' ? 60 : 1);
  return `${Math.max(10, Math.round(seconds / factor))}s`;
}

/** Seconds VU `vu` (1-based) waits before its "going" call: linear across the window. */
function staggerSeconds(vu, vus, windowSeconds) {
  return ((vu - 1) * windowSeconds) / vus;
}

// Arrival window, in seconds, derived from the selected profile only.
const ARRIVAL_WINDOW = shrink(PROFILE.ramp, 3);
const ARRIVAL_WINDOW_SECONDS = parseDurationSeconds(ARRIVAL_WINDOW);

export const options = {
  scenarios: {
    rsvp_burst: {
      // One VU per profile seat, one iteration each: a single going → none
      // cycle, no loop. The ramp lives in the per-VU stagger below.
      executor: 'per-vu-iterations',
      vus: PROFILE.vus,
      iterations: 1,
      // Stagger (≤ 60 s) + two RPCs + a short dwell per VU; generous so a
      // slow staging instance still records rather than truncates.
      maxDuration: '5m',
      gracefulStop: '30s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(
    THRESHOLDS.rsvp,
    THRESHOLDS.errors,
    // Any non-2xx going or cancel fails the run (PT429 included).
    { rsvp_ok: ['rate==1'] },
  ),
  tags: { script: 'watch-party-rsvp', stage: String(STAGE) },
};

function is2xx(res) {
  return res.status >= 200 && res.status < 300;
}

export function setup() {
  console.log(
    `[watch-party-rsvp] stage ${STAGE}: ${PROFILE.vus} VUs x 1 going→none cycle, ` +
      `arrivals spread over ${ARRIVAL_WINDOW} (ramp ${PROFILE.ramp} / 3) on party ${PARTY_ID}`,
  );
  return { sessions: acquireSessions() };
}

export default function (data) {
  const session = sessionForVu(data.sessions);
  const headers = authHeaders(session.jwt);

  // Linear arrival: VU 1 goes immediately, VU N just before the window ends.
  sleep(staggerSeconds(__VU, PROFILE.vus, ARRIVAL_WINDOW_SECONDS));

  const going = rpc(REST_URL, 'rsvp_to_watch_party', { p_party_id: PARTY_ID, p_status: 'going' }, headers, rsvpLatency);
  rsvpOk.add(is2xx(going));
  check(going, { 'rsvp going 2xx': is2xx });

  // A person who taps "going" and then changes their mind does so after a
  // beat, not instantly; keep the dwell short so the cancels also overlap.
  sleep(think(2, 1));

  const cancel = rpc(REST_URL, 'rsvp_to_watch_party', { p_party_id: PARTY_ID, p_status: 'none' }, headers, rsvpLatency);
  rsvpOk.add(is2xx(cancel));
  check(cancel, { 'rsvp cancel 2xx': is2xx });
}
