#!/usr/bin/env node
/**
 * cleanup-users.mjs — remove the load-test users and everything they wrote.
 *
 *   node scripts/load/cleanup-users.mjs            # dry run: counts only
 *   node scripts/load/cleanup-users.mjs --apply    # delete
 *
 * Selects auth users whose email matches <prefix>+NNNNN@<domain> (the
 * seed-users.mjs shape) OR whose user_metadata.load_test is true, then in
 * FK-safe order (see supabase/scripts/cleanup_test_users.sql for the map —
 * these tables have bare user_id columns, no cascades):
 *   messages, chat_room_members, watch_party_rsvps  (user_id = auth uid)
 *   public.users                                    (auth_id)
 *   auth.users                                      (admin API)
 * Load scripts only ever write those three content tables; anything else
 * authored by a load user (should not exist) is left for the SQL script.
 *
 * Refuses to run against production. The reviewer account and every
 * non-matching account are never touched.
 */
import {
  assertSafeTarget,
  parseArgs,
  requestJson,
  mapLimit,
  writeJson,
  USERS_FILE,
  TOKENS_FILE,
} from './_lib.mjs';
import fs from 'node:fs';

const args = parseArgs();
const APPLY = args.apply === true;
const PREFIX = String(args.prefix || 'loadtest');
const DOMAIN = String(args.domain || 'load.fansphere.test');
const PATTERN = new RegExp(`^${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\+\\d+@${DOMAIN.replace(/\./g, '\\.')}$`, 'i');

const { url, ref, key } = assertSafeTarget('service_role');
const admin = { apikey: key, Authorization: `Bearer ${key}` };

// 1. Enumerate matching auth users.
const targets = [];
for (let page = 1; ; page++) {
  const res = await requestJson(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: admin });
  if (res.status !== 200) {
    console.error(`admin list: ${res.status} ${res.text.slice(0, 200)}`);
    process.exit(1);
  }
  const users = res.json?.users || [];
  for (const u of users) {
    const email = String(u.email || '');
    if (email === 'fansphere.reviewer@gmail.com') continue;
    if (PATTERN.test(email) || u.user_metadata?.load_test === true) targets.push({ id: u.id, email });
  }
  if (users.length < 1000) break;
}
console.log(`${ref}: ${targets.length} load-test auth users match.`);
if (!targets.length) process.exit(0);

const ids = targets.map((t) => t.id);
const chunks = [];
for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

async function countRows(table, col) {
  let n = 0;
  for (const chunk of chunks) {
    const res = await requestJson(`${url}/rest/v1/${table}?select=${col}&${col}=in.(${chunk.join(',')})`, {
      headers: { ...admin, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
    });
    const cr = res.headers.get('content-range') || '';
    n += Number(cr.split('/')[1] || 0);
  }
  return n;
}

async function deleteRows(table, col) {
  let n = 0;
  for (const chunk of chunks) {
    const res = await requestJson(`${url}/rest/v1/${table}?${col}=in.(${chunk.join(',')})`, {
      method: 'DELETE',
      headers: { ...admin, Prefer: 'return=representation' },
    });
    if (res.status === 200) n += Array.isArray(res.json) ? res.json.length : 0;
    else console.error(`  DELETE ${table}: ${res.status} ${res.text.slice(0, 160)}`);
  }
  return n;
}

const plan = [
  ['messages', 'user_id'],
  ['chat_room_members', 'user_id'],
  ['watch_party_rsvps', 'user_id'],
  ['users', 'auth_id'],
];

for (const [table, col] of plan) {
  console.log(`  ${table}: ${await countRows(table, col)} rows`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

for (const [table, col] of plan) {
  console.log(`  deleted ${await deleteRows(table, col)} from ${table}`);
}

let deleted = 0;
await mapLimit(targets, 5, async (t) => {
  const res = await requestJson(`${url}/auth/v1/admin/users/${t.id}`, { method: 'DELETE', headers: admin });
  if (res.status === 200 || res.status === 204) deleted += 1;
  else console.error(`  auth delete ${t.email}: ${res.status}`);
});
console.log(`  deleted ${deleted}/${targets.length} auth users`);

for (const f of [USERS_FILE, TOKENS_FILE]) {
  if (fs.existsSync(f)) {
    writeJson(f, []);
    console.log(`  emptied ${f}`);
  }
}
