import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * k6 Load Test: Watch Party RSVP Burst
 *
 * Tests the rsvp_to_watch_party RPC under concurrent load.
 * This exercises row-level locking and capacity checks.
 *
 * Run: k6 run --env SUPABASE_URL=xxx --env SUPABASE_KEY=xxx --env PARTY_ID=xxx watch-party-rsvp.js
 */

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_KEY = __ENV.SUPABASE_KEY;
const PARTY_ID = __ENV.PARTY_ID || '00000000-0000-0000-0000-000000000001';

const errorRate = new Rate('errors');

export const options = {
  scenarios: {
    rsvp_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 2000 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    errors: ['rate<0.05'],
  },
};

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export default function () {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/rsvp_to_watch_party`,
    JSON.stringify({
      p_party_id: PARTY_ID,
      p_status: 'going',
    }),
    { headers }
  );

  check(res, {
    'rsvp success': (r) => r.status === 200 || r.status === 204,
    'not rate limited': (r) => r.status !== 429,
  }) || errorRate.add(1);

  sleep(0.5);
}
