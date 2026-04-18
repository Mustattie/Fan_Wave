import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * k6 Load Test: Home Screen Data Fetch
 *
 * Simulates the 3 parallel queries the Home tab makes on load:
 *   1. Games (with team joins)
 *   2. Watch parties (city-filtered)
 *   3. My groups (user-filtered)
 *
 * Run: k6 run --env SUPABASE_URL=https://xxx.supabase.co --env SUPABASE_KEY=xxx home-screen.js
 */

const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_KEY = __ENV.SUPABASE_KEY;

const errorRate = new Rate('errors');
const gamesLatency = new Trend('games_latency', true);
const partiesLatency = new Trend('parties_latency', true);
const groupsLatency = new Trend('groups_latency', true);

export const options = {
  stages: [
    { duration: '2m', target: 1000 },   // Ramp up to 1K users
    { duration: '5m', target: 5000 },   // Ramp to 5K
    { duration: '5m', target: 10000 },  // Ramp to 10K
    { duration: '3m', target: 10000 },  // Sustain 10K
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95th percentile < 2s
    errors: ['rate<0.01'],              // Error rate < 1%
  },
};

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

export default function () {
  // 1. Fetch games
  const today = new Date().toISOString().split('T')[0];
  const gamesStart = Date.now();
  const gamesRes = http.get(
    `${SUPABASE_URL}/rest/v1/games?select=*,home_team:teams!home_team_id(*),away_team:teams!away_team_id(*)&scheduled_at=gte.${today}&order=scheduled_at.asc&limit=10`,
    { headers }
  );
  gamesLatency.add(Date.now() - gamesStart);
  check(gamesRes, { 'games 200': (r) => r.status === 200 }) || errorRate.add(1);

  // 2. Fetch watch parties
  const partiesStart = Date.now();
  const partiesRes = http.get(
    `${SUPABASE_URL}/rest/v1/watch_parties?select=*,sport:sports!sport_id(*)&venue_city=ilike.Chicago&starts_at=gt.${new Date().toISOString()}&order=starts_at.asc&limit=3`,
    { headers }
  );
  partiesLatency.add(Date.now() - partiesStart);
  check(partiesRes, { 'parties 200': (r) => r.status === 200 }) || errorRate.add(1);

  // 3. Fetch groups (uses RPC)
  const groupsStart = Date.now();
  const groupsRes = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/browse_public_groups`,
    JSON.stringify({ p_city: 'Chicago', p_limit: 10 }),
    { headers }
  );
  groupsLatency.add(Date.now() - groupsStart);
  check(groupsRes, { 'groups 200': (r) => r.status === 200 }) || errorRate.add(1);

  sleep(1);
}
