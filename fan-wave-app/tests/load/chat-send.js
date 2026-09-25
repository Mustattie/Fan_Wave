/**
 * k6 — Game-chat send path under load.
 *
 * Reproduces app/fan-group/[id].tsx handleSend exactly:
 *   1. rpc check_rate_limit(p_user_id, 'message_send', 60, 60)   (mig 099/103)
 *   2. INSERT messages {chat_room_id, user_id: auth.uid(), content}
 * Membership is established once per VU (chat_room_members self-insert;
 * 409 = already a member is fine). Each VU sends every 2–6 s, i.e. under
 * the 60/min per-user ceiling, so a rate-limit denial here is a server
 * regression, not a script artefact.
 *
 * Usage:
 *   k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=1 \
 *          --env CHAT_ROOM_ID=<uuid of a PUBLIC chat_rooms row on staging> \
 *          tests/load/chat-send.js
 *
 * Gate: chat_send p95 < 1 s, p99 < 3 s, errors < 1 %.
 * Pair with realtime-ws.js on the same room to measure fan-out.
 */
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import {
  REST_URL,
  CHAT_ROOM_ID,
  STAGE,
  PROFILE,
  THRESHOLDS,
  mergeThresholds,
  rampingStages,
  SUMMARY_TREND_STATS,
} from './lib/config.js';
import { acquireSessions, sessionForVu, authHeaders } from './lib/auth.js';
import { timedPost, rpc, think } from './lib/http.js';

const chatSend = new Trend('chat_send', true);
const rateLimitCheck = new Trend('rate_limit_check', true);
const sendDenied = new Rate('chat_send_denied'); // check_rate_limit returned false

if (!CHAT_ROOM_ID) {
  throw new Error('[chat-send] CHAT_ROOM_ID is required (a public chat_rooms.id on staging).');
}

export const options = {
  scenarios: {
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: rampingStages(),
      gracefulRampDown: '30s',
    },
  },
  setupTimeout: '15m',
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: mergeThresholds(THRESHOLDS.chat, THRESHOLDS.errors, {
    chat_send_denied: ['rate<0.01'],
  }),
  tags: { script: 'chat-send', stage: String(STAGE) },
};

export function setup() {
  console.log(`[chat-send] stage ${STAGE}: ${PROFILE.vus} VUs in room ${CHAT_ROOM_ID}`);
  return { sessions: acquireSessions() };
}

// Per-VU state survives across iterations.
let joined = false;

export default function (data) {
  const session = sessionForVu(data.sessions);
  const headers = authHeaders(session.jwt);

  if (!joined) {
    const join = timedPost(
      `${REST_URL}/chat_room_members`,
      { chat_room_id: CHAT_ROOM_ID, user_id: session.userId, role: 'member' },
      { ...headers, Prefer: 'return=minimal' },
      null,
      'chat_room_members:join'
    );
    // 201 joined, 409 already a member — both mean we can send.
    joined = join.status === 201 || join.status === 409;
    check(join, { 'joined room': () => joined });
    if (!joined) {
      sleep(think(5));
      return;
    }
  }

  const gate = rpc(
    REST_URL,
    'check_rate_limit',
    { p_user_id: session.userId, p_action: 'message_send', p_max_count: 60, p_window_seconds: 60 },
    headers,
    rateLimitCheck
  );
  const allowed = gate.status === 200 && gate.json() !== false;
  sendDenied.add(allowed ? 0 : 1);
  if (!allowed) {
    sleep(think(4));
    return;
  }

  const content = `k6 ${__VU}/${__ITER} ${Date.now().toString(36)}`;
  const send = timedPost(
    `${REST_URL}/messages`,
    { chat_room_id: CHAT_ROOM_ID, user_id: session.userId, content },
    { ...headers, Prefer: 'return=minimal' },
    chatSend,
    'messages:insert'
  );
  check(send, { 'message 201': (r) => r.status === 201 });

  sleep(think(4, 2));
}
