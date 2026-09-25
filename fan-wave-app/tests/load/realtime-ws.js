/**
 * k6 — Realtime socket load: joins, heartbeats, reconnects.
 *
 * Each VU holds one Phoenix socket like a foregrounded app session and joins
 * the two channels the app opens on a game screen (lib/realtime.ts):
 *   realtime:games-realtime            postgres_changes UPDATE on games
 *   realtime:room-messages-<CHAT_ROOM_ID>  postgres_changes INSERT on messages
 *                                          filtered chat_room_id=eq.<id>
 * Half-way through the session the VU drops the socket and reconnects,
 * measuring whether it is re-joined within 10 s (the P2.1 jittered-reconnect
 * budget). Events received are counted but not asserted — pair with
 * chat-send.js on the same room to generate INSERT fan-out.
 *
 * PROTOCOL NOTE — UNVERIFIED against a live project. The wire format below
 * (vsn=1.0.0, phx_join payload {config:{postgres_changes,…}, access_token},
 * 'phoenix' heartbeat, phx_reply status ok, 'system' status for the
 * postgres_changes subscription) is what realtime-js v2 sends; confirm the
 * first stage-1 run's join replies before trusting the numbers.
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=1 \
 *          --env CHAT_ROOM_ID=<uuid> [--env SESSION_SECONDS=120] \
 *          tests/load/realtime-ws.js
 *
 * Capacity: stage 5 = 10 000 open sockets; run from a cloud VM or split
 * across machines with --execution-segment (README). Prod Realtime config:
 * max_concurrent_users 10 000, max_joins_per_second 2 500 — a 5 min ramp to
 * 10 000 VUs joins ~33 sockets/s, well under the join ceiling.
 *
 * Gate: ws_connect_errors < 0.5 %, ws_join_ok > 99 %, ws_rejoin_within_10s ≥ 99 %.
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import {
  REALTIME_WS_URL,
  SUPABASE_ANON_KEY,
  CHAT_ROOM_ID,
  STAGE,
  PROFILE,
  THRESHOLDS,
  mergeThresholds,
  rampingStages,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu } from './lib/auth.js';

const SESSION_SECONDS = Number(__ENV.SESSION_SECONDS || 120);
const HEARTBEAT_MS = 25000;
const REJOIN_BUDGET_MS = 10000;

const connectErrors = new Rate('ws_connect_errors');
const joinOk = new Rate('ws_join_ok');
const rejoinWithin10s = new Rate('ws_rejoin_within_10s');
const joinLatency = new Trend('ws_join_latency', true);
const eventsReceived = new Counter('ws_events_received');
const heartbeatsAcked = new Counter('ws_heartbeats_acked');

export const options = {
  scenarios: {
    sockets: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: rampingStages(),
      gracefulRampDown: '30s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(THRESHOLDS.wsConnect, THRESHOLDS.wsJoin, THRESHOLDS.rejoin, {
    ws_join_latency: ['p(95)<2000'],
  }),
  tags: { script: 'realtime-ws', stage: String(STAGE) },
};

export function setup() {
  console.log(
    `[realtime-ws] stage ${STAGE}: ${PROFILE.vus} sockets, ${SESSION_SECONDS}s sessions` +
      (CHAT_ROOM_ID ? `, room ${CHAT_ROOM_ID}` : ', games channel only')
  );
  return { sessions: acquireSessions() };
}

function channelSpecs(jwt) {
  const specs = [
    {
      topic: 'realtime:games-realtime',
      changes: [{ event: 'UPDATE', schema: 'public', table: 'games' }],
    },
  ];
  if (CHAT_ROOM_ID) {
    specs.push({
      topic: `realtime:room-messages-${CHAT_ROOM_ID}`,
      changes: [
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_room_id=eq.${CHAT_ROOM_ID}` },
      ],
    });
  }
  return specs.map((s) => ({
    ...s,
    join: {
      topic: s.topic,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '' },
          postgres_changes: s.changes,
          private: false,
        },
        access_token: jwt,
      },
    },
  }));
}

/**
 * One socket lifetime. Returns { connected, joinedAll, joinMs } and records
 * metrics. `holdMs` is how long to keep the socket after joining.
 */
function runSocket(jwt, holdMs, label) {
  const url = `${REALTIME_WS_URL}?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
  const specs = channelSpecs(jwt);
  const pending = new Set(specs.map((s) => s.topic));
  let ref = 0;
  let joinStart = 0;
  let joinMs = null;
  let connected = false;
  const refs = new Map(); // ref -> topic

  const res = ws.connect(url, { tags: { name: `ws:${label}` } }, (socket) => {
    socket.on('open', () => {
      connected = true;
      joinStart = Date.now();
      for (const spec of specs) {
        ref += 1;
        refs.set(String(ref), spec.topic);
        socket.send(JSON.stringify({ ...spec.join, ref: String(ref) }));
      }
      socket.setInterval(() => {
        ref += 1;
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref) }));
      }, HEARTBEAT_MS);
    });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (_e) {
        return;
      }
      if (msg.topic === 'phoenix' && msg.event === 'phx_reply') {
        heartbeatsAcked.add(1);
        return;
      }
      if (msg.event === 'phx_reply' && refs.has(String(msg.ref))) {
        const topic = refs.get(String(msg.ref));
        const ok = msg.payload && msg.payload.status === 'ok';
        if (ok) pending.delete(topic);
        else {
          console.warn(`[realtime-ws] join ${topic} failed: ${JSON.stringify(msg.payload).slice(0, 200)}`);
          socket.close();
        }
        if (pending.size === 0 && joinMs === null) {
          joinMs = Date.now() - joinStart;
          joinLatency.add(joinMs);
        }
        return;
      }
      if (msg.event === 'system' && msg.payload && msg.payload.status === 'error') {
        console.warn(`[realtime-ws] ${msg.topic} system error: ${String(msg.payload.message).slice(0, 200)}`);
        socket.close();
        return;
      }
      if (msg.event === 'postgres_changes' || msg.event === 'broadcast') {
        eventsReceived.add(1);
      }
    });

    socket.on('error', (e) => {
      console.warn(`[realtime-ws] socket error: ${e && e.error ? e.error() : e}`);
    });

    socket.setTimeout(() => socket.close(), holdMs);
  });

  const okStatus = res && res.status === 101;
  connectErrors.add(okStatus && connected ? 0 : 1);
  const joinedAll = joinMs !== null;
  if (connected) joinOk.add(joinedAll ? 1 : 0);
  return { connected, joinedAll, joinMs };
}

export default function (data) {
  const session = sessionForVu(data.sessions);
  const half = Math.max(5000, (SESSION_SECONDS * 1000) / 2);

  const first = runSocket(session.jwt, half, 'initial');
  check(first, { 'initial join ok': (r) => r.joinedAll });

  // Drop → reconnect, like a cellular blip. lib/realtime.ts jitters its
  // reconnect 1–3 s before re-subscribing; give the same head-room here.
  sleep(1 + Math.random() * 2);
  const again = runSocket(session.jwt, half, 'rejoin');
  rejoinWithin10s.add(again.joinedAll && again.joinMs <= REJOIN_BUDGET_MS ? 1 : 0);
  check(again, { 'rejoin ok': (r) => r.joinedAll });

  sleep(1);
}
