/**
 * k6 — Signed-in feed load: what one app session pulls when it opens.
 *
 * Mirrors the queries the Home / Discover / Clips tabs issue on focus
 * (hooks/useData.ts, app/(tabs)/discover.tsx, app/(tabs)/clips.tsx):
 *   1. games with team joins (both FKs non-null), next 10 from today
 *   2. watch parties near the metro anchor, next 20 (falls back to the
 *      wider list exactly like Discover does when the city has none)
 *   3. browse_public_groups(city)
 *   4. media_clips page 0 (newest first), 10 rows
 * then a 5–12 s think time, like a user scanning the screen.
 *
 * Usage (never production — lib/config.js refuses the prod ref):
 *   k6 run --env SUPABASE_URL=https://<staging>.supabase.co \
 *          --env SUPABASE_ANON_KEY=... --env STAGE=1 \
 *          [--env LOAD_TOKENS_FILE=/abs/path/tokens.json] \
 *          [--env HOME_CITY=Chicago] tests/load/home-screen.js
 *
 * Gate: feed p95 < 800 ms per query, errors < 1 % (README "Stage gate rules").
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
  rampingStages,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu, authHeaders } from './lib/auth.js';
import { timedGet, timedPost, think } from './lib/http.js';

const gamesLatency = new Trend('games_latency', true);
const partiesLatency = new Trend('parties_latency', true);
const groupsLatency = new Trend('groups_latency', true);
const clipsLatency = new Trend('clips_latency', true);
const feedLatency = new Trend('feed_latency', true); // whole screen, all 4 calls

export const options = {
  scenarios: {
    feed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: rampingStages(),
      gracefulRampDown: '30s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(
    THRESHOLDS.feed,
    THRESHOLDS.games,
    THRESHOLDS.parties,
    THRESHOLDS.groups,
    THRESHOLDS.clips,
    THRESHOLDS.errors
  ),
  tags: { script: 'home-screen', stage: String(STAGE) },
};

export function setup() {
  console.log(`[home-screen] stage ${STAGE}: ${PROFILE.vus} VUs, city "${HOME_CITY}"`);
  return { sessions: acquireSessions() };
}

const cityAnchor = `"${HOME_CITY.split(',')[0].trim().replace(/"/g, '')}"`;

export default function (data) {
  const session = sessionForVu(data.sessions);
  const headers = authHeaders(session.jwt);
  const screenStart = Date.now();

  const today = new Date().toISOString().split('T')[0];
  const games = timedGet(
    `${REST_URL}/games?select=*,home_team:teams!home_team_id(*),away_team:teams!away_team_id(*)` +
      `&home_team_id=not.is.null&away_team_id=not.is.null` +
      `&scheduled_at=gte.${today}&order=scheduled_at.asc&limit=10`,
    headers,
    gamesLatency,
    'games'
  );
  check(games, { 'games 200': (r) => r.status === 200 });

  const startedAfter = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  let parties = timedGet(
    `${REST_URL}/watch_parties?select=*,sport:sports!sport_id(*)` +
      `&starts_at=gt.${encodeURIComponent(startedAfter)}` +
      `&or=(venue_metro.ilike.${encodeURIComponent(cityAnchor)},venue_city.ilike.${encodeURIComponent(cityAnchor)})` +
      `&order=starts_at.asc&limit=20`,
    headers,
    partiesLatency,
    'watch_parties:near'
  );
  if (parties.status === 200 && Array.isArray(parties.json()) && parties.json().length === 0) {
    parties = timedGet(
      `${REST_URL}/watch_parties?select=*,sport:sports!sport_id(*)` +
        `&starts_at=gt.${encodeURIComponent(startedAfter)}&order=starts_at.asc&limit=20`,
      headers,
      partiesLatency,
      'watch_parties:wider'
    );
  }
  check(parties, { 'parties 200': (r) => r.status === 200 });

  const groups = timedPost(
    `${REST_URL}/rpc/browse_public_groups`,
    { p_city: HOME_CITY.split(',')[0].trim(), p_limit: 10 },
    headers,
    groupsLatency,
    'rpc:browse_public_groups'
  );
  check(groups, { 'groups 200': (r) => r.status === 200 });

  const clips = timedGet(
    `${REST_URL}/media_clips?select=*&order=created_at.desc,id.desc&limit=10`,
    { ...headers, Range: '0-9', 'Range-Unit': 'items' },
    clipsLatency,
    'media_clips:page0'
  );
  check(clips, { 'clips 2xx': (r) => r.status === 200 || r.status === 206 });

  feedLatency.add(Date.now() - screenStart);
  sleep(think(8, 4));
}
