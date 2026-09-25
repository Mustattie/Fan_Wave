/**
 * k6 — RSVP burst on one watch party (row lock + capacity check).
 *
 * rsvp_to_watch_party(p_party_id UUID, p_status TEXT) is SECURITY DEFINER and
 * keyed on auth.uid(), so every VU runs as its own signed-in user. Each
 * iteration toggles going → none so the party's rsvp_count stays bounded
 * and the delete-on-cancel path (mig 073) is exercised too.
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=1 \
 *          --env PARTY_ID=<uuid of a staging party with capacity >= VUs> \
 *          tests/load/watch-party-rsvp.js
 *
 * Gate: rsvp p95 < 1 s, errors < 1 %. Capacity-full rejections (P0001) are
 * counted as errors on purpose — pick a party whose capacity exceeds the
 * stage's VU count, or leave capacity NULL.
 */
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  REST_URL,
  PARTY_ID,
  STAGE,
  PROFILE,
  THRESHOLDS,
  mergeThresholds,
  rampingStages,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu, authHeaders } from './lib/auth.js';
import { rpc, think } from './lib/http.js';

const rsvpLatency = new Trend('rsvp_latency', true);

if (!PARTY_ID) {
  throw new Error('[watch-party-rsvp] PARTY_ID is required (a watch_parties.id on staging).');
}

export const options = {
  scenarios: {
    rsvp_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      // A burst is sharper than the feed profile: reach the peak in a third
      // of the stage's ramp, hold for the stage's hold.
      stages: [
        { duration: shrink(PROFILE.ramp, 3), target: PROFILE.vus },
        { duration: PROFILE.hold, target: PROFILE.vus },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(THRESHOLDS.rsvp, THRESHOLDS.errors),
  tags: { script: 'watch-party-rsvp', stage: String(STAGE) },
};

function shrink(duration, factor) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) return duration;
  const seconds = Number(m[1]) * (m[2] === 'm' ? 60 : 1);
  return `${Math.max(10, Math.round(seconds / factor))}s`;
}

export function setup() {
  console.log(`[watch-party-rsvp] stage ${STAGE}: ${PROFILE.vus} VUs on party ${PARTY_ID}`);
  return { sessions: acquireSessions() };
}

export default function (data) {
  const session = sessionForVu(data.sessions);
  const headers = authHeaders(session.jwt);

  const going = rpc(REST_URL, 'rsvp_to_watch_party', { p_party_id: PARTY_ID, p_status: 'going' }, headers, rsvpLatency);
  check(going, {
    'rsvp going 2xx': (r) => r.status >= 200 && r.status < 300,
    'not rate limited': (r) => r.status !== 429,
  });

  sleep(think(2, 1));

  const cancel = rpc(REST_URL, 'rsvp_to_watch_party', { p_party_id: PARTY_ID, p_status: 'none' }, headers, rsvpLatency);
  check(cancel, { 'rsvp cancel 2xx': (r) => r.status >= 200 && r.status < 300 });

  sleep(think(3, 2));
}
