/**
 * scripts/load/_lib.mjs — shared plumbing for the load-test helper scripts.
 *
 * Configuration comes from the environment (or `fan-wave-app/.env.loadtest`,
 * which .gitignore's `.env.*` rule keeps out of git). The variable names are
 * deliberately NOT the ones the app or EAS use (EXPO_PUBLIC_SUPABASE_URL,
 * SUPABASE_ACCESS_TOKEN…) so a prod value can never be picked up by accident:
 *
 *   STAGING_SUPABASE_URL        https://<staging-ref>.supabase.co
 *   STAGING_SUPABASE_ANON_KEY   staging anon key            (mint-tokens)
 *   STAGING_SERVICE_ROLE_KEY    staging service_role key    (seed / cleanup)
 *
 * Every script calls assertSafeTarget(), which refuses the production
 * project ref and any key whose JWT `ref` claim is production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROD_PROJECT_REF = 'fwlfiejvxmslkpoojggs';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(__dirname, '..', '..');
export const LOAD_DIR = path.join(APP_ROOT, 'tests', 'load');
export const USERS_FILE = path.join(LOAD_DIR, 'users.json');
export const TOKENS_FILE = path.join(LOAD_DIR, 'tokens.json');

export function loadDotEnv(file = path.join(APP_ROOT, '.env.loadtest')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/**
 * Returns { url, ref, key } or exits. `role` is 'anon' or 'service_role' and
 * is enforced against the key's JWT claim.
 */
export function assertSafeTarget(role) {
  loadDotEnv();
  const url = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
  const key =
    role === 'service_role'
      ? process.env.STAGING_SERVICE_ROLE_KEY
      : process.env.STAGING_SUPABASE_ANON_KEY;

  if (!url) fail('STAGING_SUPABASE_URL is not set (env or fan-wave-app/.env.loadtest).');
  if (url.includes(PROD_PROJECT_REF)) {
    fail(`REFUSING: STAGING_SUPABASE_URL points at the PRODUCTION project (${PROD_PROJECT_REF}).`);
  }
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url)?.[1];
  if (!ref) fail(`STAGING_SUPABASE_URL must look like https://<ref>.supabase.co (got ${url}).`);
  if (!key) {
    fail(
      role === 'service_role'
        ? 'STAGING_SERVICE_ROLE_KEY is not set.'
        : 'STAGING_SUPABASE_ANON_KEY is not set.'
    );
  }
  const payload = decodeJwtPayload(key);
  if (payload) {
    if (payload.ref === PROD_PROJECT_REF) fail('REFUSING: the key belongs to the PRODUCTION project.');
    if (payload.ref && payload.ref !== ref) {
      fail(`Key ref (${payload.ref}) does not match STAGING_SUPABASE_URL ref (${ref}).`);
    }
    if (payload.role !== role) {
      fail(`Expected a ${role} key, got role="${payload.role}".`);
    }
  }
  return { url, ref, key };
}

export async function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, headers: res.headers, json, text };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn(item)` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function readJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
