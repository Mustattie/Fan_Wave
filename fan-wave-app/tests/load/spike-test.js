/**
 * k6 — Kickoff spike: baseline → stage peak in 10 s, hold, cool down.
 *
 * The pre-v9.5 version of this script ramped to 50 000 anon VUs, which no
 * single machine can generate and which measured only the anon path. This
 * one spikes to the selected STAGE's VU count with signed-in sessions and
 * the same read mix the app produces around a kickoff:
 *   40 % live games      20 % watch parties    20 % trending clips
 *   10 % browse groups   10 % my RSVPs
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=2 \
 *          [--env LOAD_TOKENS_FILE=/abs/tokens.json] tests/load/spike-test.js
 *
 * Gate: feed p95 < 800 ms on the sustained plateau (the 10 s spike itself is
 * reported but not gated: `http_req_duration{phase:spike}` vs `{phase:hold}`),
 * errors < 1 % overall.
 */
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  REST_URL,
  HOME_CITY,
  STAGE,
  PROFILE,
  THRESHOLDS,
  mergeThresholds,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu, authHeaders } from './lib/auth.js';
import { timedGet, timedPost, think } from './lib/http.js';

const feedLatency = new Trend('feed_latency', true);
const BASELINE = Math.max(10, Math.round(PROFILE.vus / 20));

export const options = {
  scenarios: {
    kickoff: {
      executor: 'ramping-vus',
      startVUs: BASELINE,
      stages: [
        { duration: '30s', target: BASELINE },
        { duration: '10s', target: PROFILE.vus },
        { duration: PROFILE.hold, target: PROFILE.vus },
        { duration: '1m', target: BASELINE },
      ],
      gracefulRampDown: '15s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(THRESHOLDS.feed, THRESHOLDS.errors, {
    'http_req_duration{phase:hold}': ['p(95)<800'],
    'http_req_duration{phase:spike}': ['p(99)<5000'],
  }),
  tags: { script: 'spike-test', stage: String(STAGE) },
};

let spikeEndsAt = 0;

export function setup() {
  console.log(`[spike-test] stage ${STAGE}: ${BASELINE} → ${PROFILE.vus} VUs in 10 s`);
  return { sessions: acquireSessions(), startedAt: Date.now() };
}

export default function (data) {
  if (!spikeEndsAt) spikeEndsAt = data.startedAt + 40 * 1000; // 30 s baseline + 10 s spike
  const phase = Date.now() < spikeEndsAt ? 'spike' : 'hold';
  const session = sessionForVu(data.sessions);
  const headers = authHeaders(session.jwt);
  const city = HOME_CITY.split(',')[0].trim();

  const roll = Math.random();
  let res;
  if (roll < 0.4) {
    res = timedGet(
      `${REST_URL}/games?select=id,home_score,away_score,status,scheduled_at&status=eq.in&limit=20`,
      headers,
      feedLatency,
      'games:live',
      { phase }
    );
  } else if (roll < 0.6) {
    res = timedGet(
      `${REST_URL}/watch_parties?select=id,title,rsvp_count,starts_at&starts_at=gt.${new Date().toISOString()}&order=starts_at.asc&limit=10`,
      headers,
      feedLatency,
      'watch_parties:upcoming',
      { phase }
    );
  } else if (roll < 0.8) {
    res = timedGet(`${REST_URL}/trending_clips?select=*&limit=20`, headers, feedLatency, 'trending_clips', { phase });
  } else if (roll < 0.9) {
    res = timedPost(
      `${REST_URL}/rpc/browse_public_groups`,
      { p_city: city, p_limit: 10 },
      headers,
      feedLatency,
      'rpc:browse_public_groups',
      { phase }
    );
  } else {
    res = timedGet(
      `${REST_URL}/watch_party_rsvps?select=watch_party_id,status&user_id=eq.${session.userId}&limit=20`,
      headers,
      feedLatency,
      'watch_party_rsvps:mine',
      { phase }
    );
  }
  check(res, { 'status 2xx': (r) => r.status >= 200 && r.status < 300 });

  sleep(think(0.5, 0.3));
}
