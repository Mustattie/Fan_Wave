#!/usr/bin/env node
/**
 * seed-users.mjs — create N confirmed load-test users on the STAGING project.
 *
 *   node scripts/load/seed-users.mjs --count 100 [--city Chicago] \
 *        [--prefix loadtest] [--domain load.fansphere.test] [--concurrency 5]
 *
 * Uses the GoTrue admin endpoint (service_role) with email_confirm=true so
 * no mail is sent and no confirmation click is needed. The on_auth_user_created
 * trigger (mig 033) creates the public.users row; --city then sets home_city
 * so the "parties near you" query in home-screen.js has something to match.
 *
 * Output: tests/load/users.json  [{ email, password, userId }]  (gitignored)
 * Re-running with a larger --count appends only the missing indices;
 * existing entries are kept so their passwords stay valid.
 *
 * Refuses to run against production (see _lib.mjs assertSafeTarget).
 */
import crypto from 'node:crypto';
import {
  assertSafeTarget,
  parseArgs,
  requestJson,
  mapLimit,
  readJsonArray,
  writeJson,
  USERS_FILE,
  sleep,
} from './_lib.mjs';

const args = parseArgs();
const COUNT = Number(args.count || 100);
const PREFIX = String(args.prefix || 'loadtest');
const DOMAIN = String(args.domain || 'load.fansphere.test');
const CITY = args.city ? String(args.city) : 'Chicago';
const CONCURRENCY = Number(args.concurrency || 5);

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 20000) {
  console.error('--count must be an integer between 1 and 20000');
  process.exit(1);
}

const { url, ref, key } = assertSafeTarget('service_role');
const admin = { apikey: key, Authorization: `Bearer ${key}` };

const existing = readJsonArray(USERS_FILE);
const byEmail = new Map(existing.map((u) => [u.email, u]));
const wanted = Array.from({ length: COUNT }, (_, i) => `${PREFIX}+${String(i + 1).padStart(5, '0')}@${DOMAIN}`);
const missing = wanted.filter((e) => !byEmail.has(e));

console.log(`Target ${ref}: ${wanted.length} users wanted, ${missing.length} to create, city "${CITY}".`);

let created = 0;
let failed = 0;

await mapLimit(missing, CONCURRENCY, async (email, i) => {
  const password = crypto.randomBytes(18).toString('base64url');
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await requestJson(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: admin,
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Load Tester ${i + 1}`, load_test: true },
      },
    });
    if (res.status === 200 || res.status === 201) {
      byEmail.set(email, { email, password, userId: res.json?.id });
      created += 1;
      if (created % 50 === 0) console.log(`  created ${created}/${missing.length}`);
      return;
    }
    if (res.status === 422 && /already|exists/i.test(res.text)) {
      // Exists on the server but not in users.json (previous run lost the
      // file). Reset its password so the local record is authoritative.
      const list = await requestJson(`${url}/auth/v1/admin/users?page=1&per_page=1&email=${encodeURIComponent(email)}`, { headers: admin });
      const id = list.json?.users?.[0]?.id;
      if (id) {
        const upd = await requestJson(`${url}/auth/v1/admin/users/${id}`, { method: 'PUT', headers: admin, body: { password } });
        if (upd.status === 200) {
          byEmail.set(email, { email, password, userId: id });
          created += 1;
          return;
        }
      }
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 5) * 1000;
      await sleep(wait);
      continue;
    }
    console.error(`  ${email}: ${res.status} ${res.text.slice(0, 160)}`);
    failed += 1;
    return;
  }
  failed += 1;
});

const users = wanted.map((e) => byEmail.get(e)).filter(Boolean);
writeJson(USERS_FILE, users);
console.log(`Wrote ${users.length} users to ${USERS_FILE} (${created} created, ${failed} failed).`);

// home_city so the metro-anchored party query matches something.
if (CITY && users.length) {
  const ids = users.map((u) => u.userId).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  let updated = 0;
  for (const chunk of chunks) {
    const res = await requestJson(
      `${url}/rest/v1/users?auth_id=in.(${chunk.join(',')})`,
      { method: 'PATCH', headers: { ...admin, Prefer: 'return=minimal' }, body: { home_city: CITY } }
    );
    if (res.status === 204) updated += chunk.length;
    else console.error(`  home_city PATCH: ${res.status} ${res.text.slice(0, 160)}`);
  }
  console.log(`Set home_city="${CITY}" on ${updated} profiles.`);
}

if (failed) process.exit(2);
