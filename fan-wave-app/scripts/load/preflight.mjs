#!/usr/bin/env node
/**
 * preflight.mjs — read-only readiness check for a load-test run.
 *
 *   node scripts/load/preflight.mjs [--stage baseline|campus|spike|1..5] [--ref <project-ref>]
 *
 * Proves, before any k6 process starts, that
 *   1. the tools are present (node, k6). k6 is looked for in this order:
 *      K6_BIN (an explicit path; a missing file is a blocker, not a
 *      fallback), the portable copy under
 *      %LOCALAPPDATA%\FanSphereTools\k6\k6-v<ver>-windows-amd64\k6.exe,
 *      then PATH. The chosen binary is printed so the run can be
 *      reproduced with the same one;
 *   2. the target in fan-wave-app/.env.loadtest is NOT production: the URL
 *      ref, the anon key's JWT `ref` claim and (when set) the service_role
 *      key's claim all agree and none is the prod ref;
 *   3. the project's name and status, read through the Management API with
 *      SUPABASE_ACCESS_TOKEN (env or fan-wave-app/.env.supabase), do not look
 *      like production (a name containing "prod" is refused);
 *   4. the schema the k6 scripts need (tests/load/requirements.json) exists,
 *      read from the project's PostgREST OpenAPI document with the anon key;
 *   5. the seeded users / pre-minted tokens cover the chosen profile and the
 *      tokens have not aged past their 3600 s TTL.
 *
 * It sends only GETs and prints no key or token value. Exit 0 = READY,
 * exit 1 = BLOCKED (the blockers and the shortest unblock are listed).
 * `--ref` alone (no .env.loadtest) runs just the Management API check;
 * with neither a URL nor --ref it makes no network request at all.
 *
 * A FORBIDDEN target (the production ref in the URL, in --ref, or in any
 * key's `ref` claim) short-circuits every remote check: steps 3 and 4 are
 * reported as "skipped; target is forbidden" and no request of any kind is
 * sent to the Management API or to the project. Local reporting (tools,
 * profile data) still runs so the full unblock list is printed. All network
 * goes through remoteGet(), which refuses outright while the target is
 * forbidden, so no later step can reach production by accident.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  APP_ROOT,
  LOAD_DIR,
  USERS_FILE,
  TOKENS_FILE,
  PROD_PROJECT_REF,
  loadDotEnv,
  parseArgs,
  decodeJwtPayload,
  requestJson,
} from './_lib.mjs';

const args = parseArgs();
const STAGE_VUS = { 1: 100, 2: 500, 3: 1000, 4: 5000, 5: 10000, baseline: 50, campus: 300, spike: 600 };
// ramp + hold + rampDown from tests/load/lib/config.js, in seconds.
const STAGE_SECONDS = { 1: 270, 2: 480, 3: 540, 4: 720, 5: 1020, baseline: 390, campus: 840, spike: 250 };
const JWT_TTL_SECONDS = 3600;
const stageRaw = String(args.stage || 'baseline').toLowerCase();
const stage = STAGE_VUS[stageRaw] ? stageRaw : null;

const okList = [];
const warnList = [];
const blockers = [];
const ok = (m) => { okList.push(m); console.log(`  PASS  ${m}`); };
const warn = (m) => { warnList.push(m); console.log(`  WARN  ${m}`); };
const block = (m, fix) => { blockers.push({ m, fix }); console.log(`  BLOCK ${m}`); };
/**
 * True once any input names the production project. Set only through
 * forbid(); read by every remote step, which then reports itself skipped.
 */
let forbidden = false;
const forbid = (m, fix) => { forbidden = true; block(m, fix); };
const FORBIDDEN_SKIP = 'skipped; target is forbidden (production): no remote request is made';
/**
 * The only path from this script to the network. Refuses while the target
 * is forbidden so that no step, present or future, can send a request to
 * production even if its own skip check is forgotten.
 */
async function remoteGet(url, opts) {
  if (forbidden) throw new Error(`refusing remote request to ${url}: target is forbidden`);
  return requestJson(url, opts);
}

console.log('Load-test preflight (read-only)\n');

// 1. tools -----------------------------------------------------------------
console.log('Tools');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) ok(`node ${process.versions.node}`);
else block(`node ${process.versions.node} is too old for the helper scripts (fetch needs 18+)`, 'install Node 18 or newer');
/** Candidate k6 binaries, most specific first. Each is {bin, how}. */
function k6Candidates() {
  const out = [];
  if (process.env.K6_BIN) out.push({ bin: process.env.K6_BIN, how: 'K6_BIN' });
  const local = process.env.LOCALAPPDATA;
  if (process.platform === 'win32' && local) {
    const dir = path.join(local, 'FanSphereTools', 'k6');
    if (fs.existsSync(dir)) {
      const versions = fs
        .readdirSync(dir)
        .filter((d) => /^k6-v[\d.]+-windows-amd64$/.test(d))
        .sort()
        .reverse();
      for (const v of versions) out.push({ bin: path.join(dir, v, 'k6.exe'), how: `portable ${dir}` });
    }
  }
  out.push({ bin: 'k6', how: 'PATH' });
  return out;
}
const k6Install = process.platform === 'win32' ? 'winget install k6 --source winget' : 'brew install k6';
/**
 * Run `<bin> version` without a shell and return the spawnSync result.
 * Real executables (k6.exe, k6 on PATH) are started directly. A Windows
 * .cmd/.bat wrapper (the test fake, or an operator's own K6_BIN shim)
 * cannot be started by CreateProcess, so it is handed to the command
 * interpreter the way Node's own shell:true does internally — ComSpec with
 * /d /s /c and a verbatim command line — but with a fixed, quoted command
 * (`"<bin>" version`) instead of a free-form shell string, and no
 * `shell: true` (DEP0190 on Node 24). A wrapper path containing characters
 * cmd.exe still interprets inside quotes is refused rather than escaped.
 */
function runVersion(bin) {
  const opts = { encoding: 'utf8', windowsHide: true };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    if (/["%!\r\n]/.test(bin)) {
      return { status: null, stdout: '', stderr: '', error: new Error(`refusing to run ${bin}: unsafe characters for cmd.exe`) };
    }
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawnSync(comspec, ['/d', '/s', '/c', `""${bin}" version"`], { ...opts, windowsVerbatimArguments: true });
  }
  return spawnSync(bin, ['version'], opts);
}
let k6Found = null;
for (const c of k6Candidates()) {
  if (c.how === 'K6_BIN' && !fs.existsSync(c.bin)) {
    block(`K6_BIN is set but ${c.bin} does not exist`, 'fix K6_BIN or unset it to fall back to the portable copy / PATH');
    break;
  }
  if (c.how !== 'PATH' && !fs.existsSync(c.bin)) continue;
  const r = runVersion(c.bin);
  if (r.status === 0) {
    k6Found = c;
    ok(`k6 ${String(r.stdout).trim().split('\n')[0]} via ${c.how}${c.how === 'PATH' ? '' : ` (${c.bin})`}`);
    break;
  }
  if (c.how === 'K6_BIN') {
    block(`K6_BIN ${c.bin} did not run (${r.error ? r.error.message : `exit ${r.status}`})`, 'point K6_BIN at a working k6 executable');
    break;
  }
}
if (!k6Found && !blockers.some((b) => b.m.startsWith('K6_BIN'))) {
  block(
    'k6 not found (K6_BIN unset, no portable copy under %LOCALAPPDATA%\\FanSphereTools\\k6, not on PATH)',
    `${k6Install}, or set K6_BIN=<path to k6.exe>`
  );
}
if (!stage) block(`--stage "${stageRaw}" is not a profile`, 'use baseline | campus | spike or 1..5');

// 2. target ----------------------------------------------------------------
console.log('\nTarget');
loadDotEnv();
const envFile = path.join(APP_ROOT, '.env.loadtest');
const envFileRel = path.relative(APP_ROOT, envFile);
const url = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
let ref = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url)?.[1] || '';
const refArg = args.ref ? String(args.ref) : '';
if (!url) {
  if (refArg) {
    warn(`no STAGING_SUPABASE_URL (${envFileRel} absent); Management API check only, for --ref ${refArg}`);
    ref = refArg;
  } else {
    block(
      'STAGING_SUPABASE_URL is not set',
      `create ${envFileRel} with STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY / STAGING_SERVICE_ROLE_KEY (README "One-time setup")`
    );
  }
} else if (!ref) {
  block('STAGING_SUPABASE_URL is not https://<ref>.supabase.co', 'fix the URL');
}
if (ref === PROD_PROJECT_REF) {
  forbid(`target ref ${ref} IS PRODUCTION`, 'point .env.loadtest at a staging project; never run load against prod');
} else if (ref) {
  ok(`target ref ${ref} is not the production ref (${PROD_PROJECT_REF})`);
}

const anonKey = process.env.STAGING_SUPABASE_ANON_KEY || '';
const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY || '';
function checkKey(label, key, role) {
  if (!key) {
    if (role === 'anon') block(`${label} is not set`, 'add it to .env.loadtest (Project Settings > API on the staging project)');
    else warn(`${label} is not set; seed-users / cleanup-users need it, k6 does not`);
    return false;
  }
  const p = decodeJwtPayload(key);
  if (!p) {
    warn(`${label} is not a JWT; the ref/role claims cannot be checked`);
    return true;
  }
  if (p.ref === PROD_PROJECT_REF) {
    forbid(`${label} belongs to PRODUCTION`, 'replace it with the staging key');
    return false;
  }
  if (url && p.ref && p.ref !== ref) {
    block(`${label} ref (${p.ref}) does not match the URL ref (${ref})`, 'use the key from the same project as the URL');
    return false;
  }
  if (p.role !== role) {
    block(`${label} role is "${p.role}", expected "${role}"`, 'swap the keys');
    return false;
  }
  ok(`${label}: role ${role}, ref matches, not production`);
  return true;
}
const anonOk = url ? checkKey('STAGING_SUPABASE_ANON_KEY', anonKey, 'anon') : false;
if (url) checkKey('STAGING_SERVICE_ROLE_KEY', serviceKey, 'service_role');

// 3. project identity (Management API, optional) --------------------------
console.log('\nProject identity');
let accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!accessToken) {
  const f = path.join(APP_ROOT, '.env.supabase');
  if (fs.existsSync(f)) {
    const m = /^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(f, 'utf8'));
    if (m) accessToken = m[1].replace(/^["']|["']$/g, '');
  }
}
if (forbidden) {
  warn(FORBIDDEN_SKIP);
} else if (!ref) {
  warn('no ref to look up');
} else if (!accessToken) {
  warn('SUPABASE_ACCESS_TOKEN not available; project name/status not verified (set it or fill .env.supabase)');
} else {
  const res = await remoteGet(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status !== 200) {
    warn(`Management API returned ${res.status} for ${ref}; name/status not verified`);
  } else {
    const { name, status, region } = res.json || {};
    const pgv = res.json?.database?.version;
    if (/prod/i.test(String(name))) block(`project ${ref} is named "${name}"`, 'this looks like production; pick the staging project');
    else ok(`project ${ref} is "${name}" (${region}, Postgres ${pgv || '?'})`);
    if (status === 'ACTIVE_HEALTHY') ok(`status ${status}`);
    else block(`status ${status}`, 'restore/unpause the project in the dashboard before seeding');
  }
}

// 4. schema (PostgREST OpenAPI, anon key) ---------------------------------
console.log('\nSchema (tests/load/requirements.json)');
const req = JSON.parse(fs.readFileSync(path.join(LOAD_DIR, 'requirements.json'), 'utf8'));
if (forbidden) {
  warn(FORBIDDEN_SKIP);
} else if (!url || !anonOk) {
  warn('skipped; needs STAGING_SUPABASE_URL and a usable anon key');
} else {
  const res = await remoteGet(`${url}/rest/v1/`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (res.status !== 200 || !res.json) {
    block(`OpenAPI document: HTTP ${res.status}`, 'check the URL / anon key; PostgREST serves GET /rest/v1/ to the anon key');
  } else {
    const defs = res.json.definitions || {};
    const paths = res.json.paths || {};
    const missing = [];
    for (const [table, cols] of Object.entries({ ...req.tables, ...req.views })) {
      const d = defs[table];
      if (!d) {
        missing.push(table);
        continue;
      }
      for (const c of cols) if (!d.properties || !d.properties[c]) missing.push(`${table}.${c}`);
    }
    for (const fn of req.rpcs) if (!paths[`/rpc/${fn}`]) missing.push(`rpc:${fn}`);
    if (missing.length) {
      block(
        `schema is missing ${missing.length} item(s): ${missing.join(', ')}`,
        'replay the remaining migrations onto this project (docs/migration-replay-runbook.md) or create a fresh staging project and replay 001-107'
      );
    } else {
      ok(`all ${Object.keys(req.tables).length + Object.keys(req.views).length} relations and ${req.rpcs.length} RPCs present`);
    }
    const list = req.realtime_tables.map((t) => `'${t}'`).join(',');
    warn(`realtime publication is not visible over REST; check in SQL: select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in (${list});`);
  }
}

// 5. data ------------------------------------------------------------------
console.log(`\nData for profile "${stageRaw}"`);
const vus = stage ? STAGE_VUS[stage] : 0;
const runSeconds = stage ? STAGE_SECONDS[stage] : 0;
const users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];
const tokens = fs.existsSync(TOKENS_FILE) ? JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')) : [];
if (vus && users.length >= vus) ok(`${users.length} seeded users for ${vus} VUs`);
else if (vus) block(`${users.length} seeded users for ${vus} VUs`, `node scripts/load/seed-users.mjs --count ${vus} --city Chicago`);
if (tokens.length) {
  const oldest = Math.min(...tokens.map((t) => Date.parse(t.mintedAt || 0)));
  const age = Math.round((Date.now() - oldest) / 1000);
  if (age + runSeconds > JWT_TTL_SECONDS - 120) {
    warn(`${tokens.length} pre-minted tokens are ${age}s old; they would expire during a ${runSeconds}s run; re-run scripts/load/mint-tokens.mjs`);
  } else {
    ok(`${tokens.length} pre-minted tokens, ${age}s old, valid for the ${runSeconds}s run`);
  }
} else if (vus > 100) {
  warn(`no pre-minted tokens; ${vus} VUs should pre-mint (node scripts/load/mint-tokens.mjs --rps 5) rather than sign in inside k6`);
} else if (vus) {
  ok('no pre-minted tokens; k6 setup() can mint for up to 100 VUs');
}
for (const [name, why] of [
  ['CHAT_ROOM_ID', 'chat-send.js and realtime-ws.js'],
  ['PARTY_ID', 'watch-party-rsvp.js'],
]) {
  if (process.env[name]) ok(`${name} is set (${why})`);
  else warn(`${name} is not set; needed by ${why}; create the fixture on staging and export it`);
}

// summary ------------------------------------------------------------------
console.log(`\n${blockers.length ? 'BLOCKED' : 'READY'}: ${okList.length} pass, ${warnList.length} warn, ${blockers.length} block`);
if (blockers.length) {
  console.log('\nShortest unblock, in order:');
  blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b.m}\n     fix: ${b.fix}`));
  // Set the exit code and let the event loop drain rather than calling
  // process.exit(1): on Node 24 (Windows) an abrupt exit right after fetch()
  // aborts with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
  // (exit 3221226505) while undici is still closing its socket, which would
  // replace the BLOCKED exit status with a crash. A forbidden target never
  // reaches fetch(), but blocked runs against a staging project (missing
  // schema, paused project) do, so exitCode stays the robust choice.
  process.exitCode = 1;
} else {
  console.log(
    `\nNext: k6 run --env SUPABASE_URL=${url} --env SUPABASE_ANON_KEY=<anon> --env STAGE=${stageRaw} ` +
      `tests/load/home-screen.js --summary-export=tests/load/results/${stageRaw}-home.json`
  );
}
