#!/usr/bin/env node
/**
 * mint-tokens.mjs — pre-mint one JWT per load-test user (password grant).
 *
 *   node scripts/load/mint-tokens.mjs [--rps 5] [--limit N]
 *
 * Reads tests/load/users.json, writes tests/load/tokens.json
 *   [{ email, jwt, userId, mintedAt }]
 * for k6 via --env LOAD_TOKENS_FILE=<absolute path>.
 *
 * Why outside k6: GoTrue rate-limits sign-ins per IP, and a k6 setup() that
 * mints 5 000 sessions would either take ~17 min or trip the bucket and
 * pollute the run. Mint here at a gentle --rps (Retry-After respected), then
 * start the stage within ~40 min (jwt_exp 3600 s; lib/auth.js aborts a run
 * whose tokens would expire mid-way).
 */
import {
  assertSafeTarget,
  parseArgs,
  requestJson,
  readJsonArray,
  writeJson,
  USERS_FILE,
  TOKENS_FILE,
  sleep,
} from './_lib.mjs';

const args = parseArgs();
const RPS = Number(args.rps || 5);
const LIMIT = args.limit ? Number(args.limit) : Infinity;

const { url, ref, key } = assertSafeTarget('anon');
const users = readJsonArray(USERS_FILE).slice(0, LIMIT);
if (!users.length) {
  console.error(`No users in ${USERS_FILE}. Run seed-users.mjs first.`);
  process.exit(1);
}

console.log(`Minting ${users.length} sessions on ${ref} at ${RPS}/s (~${Math.ceil(users.length / RPS)} s).`);

const tokens = [];
let failed = 0;
const spacing = 1000 / RPS;

for (let i = 0; i < users.length; i++) {
  const u = users[i];
  const started = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await requestJson(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key },
      body: { email: u.email, password: u.password },
    });
    if (res.status === 200 && res.json?.access_token) {
      tokens.push({
        email: u.email,
        jwt: res.json.access_token,
        userId: res.json.user?.id || u.userId,
        mintedAt: new Date().toISOString(),
      });
      break;
    }
    if (res.status === 429) {
      const wait = Math.min(60, Number(res.headers.get('retry-after') || 10)) * 1000;
      console.warn(`  429 at ${u.email}; waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    console.error(`  ${u.email}: ${res.status} ${res.text.slice(0, 160)}`);
    failed += 1;
    break;
  }
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${users.length}`);
  const elapsed = Date.now() - started;
  if (elapsed < spacing) await sleep(spacing - elapsed);
}

writeJson(TOKENS_FILE, tokens);
console.log(`Wrote ${tokens.length} tokens to ${TOKENS_FILE} (${failed} failed).`);
console.log(`k6 ... --env LOAD_TOKENS_FILE=${TOKENS_FILE}`);
if (failed) process.exit(2);
