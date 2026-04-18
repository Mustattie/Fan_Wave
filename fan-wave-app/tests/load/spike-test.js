import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * k6 Spike Test: Simulates World Cup match day traffic
 *
 * Pattern: Sudden 50x traffic spike (e.g., USA vs Mexico kickoff)
 * Tests: Connection pooling, query performance, error rates under load
 *
 * Run: k6 run --env SUPABASE_URL=xxx --env SUPABASE_KEY=xxx spike-test.js
 */

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_KEY = __ENV.SUPABASE_KEY;

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time', true);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '30s', target: 100 },    // Baseline
        { duration: '10s', target: 5000 },   // Spike!
        { duration: '3m', target: 5000 },    // Sustain spike
        { duration: '10s', target: 50000 },  // Mega spike
        { duration: '2m', target: 50000 },   // Sustain mega
        { duration: '1m', target: 100 },     // Cool down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<5000'],  // Relaxed for spike
    errors: ['rate<0.1'],                // Allow up to 10% errors during spike
  },
};

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export default function () {
  // Mix of read operations simulating real usage
  const rand = Math.random();

  let res;
  if (rand < 0.4) {
    // 40% — fetch games (most common)
    res = http.get(
      `${SUPABASE_URL}/rest/v1/games?select=id,home_score,away_score,status&status=eq.live&limit=20`,
      { headers }
    );
  } else if (rand < 0.7) {
    // 30% — fetch watch parties
    res = http.get(
      `${SUPABASE_URL}/rest/v1/watch_parties?select=id,title,rsvp_count&starts_at=gt.${new Date().toISOString()}&limit=10`,
      { headers }
    );
  } else if (rand < 0.9) {
    // 20% — fetch trending clips
    res = http.get(
      `${SUPABASE_URL}/rest/v1/trending_clips?limit=20`,
      { headers }
    );
  } else {
    // 10% — browse groups
    res = http.post(
      `${SUPABASE_URL}/rest/v1/rpc/browse_public_groups`,
      JSON.stringify({ p_city: 'Chicago', p_limit: 10 }),
      { headers }
    );
  }

  responseTime.add(res.timings.duration);
  check(res, { 'status ok': (r) => r.status >= 200 && r.status < 300 }) || errorRate.add(1);

  sleep(0.2 + Math.random() * 0.5); // 200-700ms between requests
}
