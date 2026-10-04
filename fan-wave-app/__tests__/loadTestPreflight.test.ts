/**
 * scripts/load/preflight.mjs is the read-only gate before any k6 run. These
 * tests drive it as a child process and pin four things:
 *   - k6 resolution honours K6_BIN (a missing K6_BIN is a blocker, never a
 *     silent fallback) and reports which binary it will use;
 *   - the production guard blocks: a prod ref in the URL, or a prod `ref`
 *     claim in EITHER key (anon or service_role), is refused even when every
 *     other input is fine;
 *   - a forbidden target short-circuits EVERY remote check: the Management
 *     API and OpenAPI steps report themselves skipped and nothing is sent;
 *   - schema discovery (GET /rest/v1/) is made with STAGING_SERVICE_ROLE_KEY,
 *     never with the anon/publishable key. Supabase answers that endpoint
 *     only to a secret key — the anon key got 401 "Secret API key required"
 *     on staging on 2026-10-04 — and k6 itself still runs with the anon key.
 *     A missing service key blocks schema verification with a clear message.
 *
 * No case may touch the network, and no case may depend on the developer's
 * real fan-wave-app/.env.loadtest: the parent env is scrubbed of STAGING_*
 * and the child is given LOADTEST_ENV_FILE pointing at a path that does not
 * exist, so the script's own dotenv reload finds nothing and the target is
 * exactly what each case passes in. Every child is started with a --require
 * preload that replaces globalThis.fetch. The default preload throws a
 * recognisable error on any call and runPreflight() fails the test if that
 * error ever appears in the output; the no-network contract is therefore
 * enforced, not assumed. The key-pinning cases use a second preload, an
 * in-process fake of the two remote endpoints the script may call: it logs
 * every request (URL and which key was sent) to a file the test reads back,
 * answers GET /rest/v1/ with an OpenAPI document built from
 * requirements.json only when the apikey is a service_role JWT (401
 * "Secret API key required" otherwise, as Supabase does), and still throws
 * the no-network error for any other URL. (The script relies on
 * process.exitCode rather than process.exit(1) because on Node 24 / Windows
 * an abrupt exit right after a real fetch() crashes with UV_HANDLE_CLOSING,
 * exit 3221226505; that path is not exercised here because no socket is
 * opened, but `status === 1` pins the clean exit.)
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'load', 'preflight.mjs');
const PROD_REF = 'fwlfiejvxmslkpoojggs';
const STAGING_REF = 'stagingrefabcdefghij';
/** Printed by the preload's fetch replacement; its presence fails any test. */
const NO_NETWORK_MARK = 'NO_NETWORK_IN_TEST';
const REQUIREMENTS = path.join(__dirname, '..', 'tests', 'load', 'requirements.json');
/** What the k6 scripts need; the fake OpenAPI document is built from the same manifest. */
const REQ = JSON.parse(fs.readFileSync(REQUIREMENTS, 'utf8')) as {
  tables: Record<string, string[]>;
  views: Record<string, string[]>;
  rpcs: string[];
};
const RELATION_COUNT = Object.keys(REQ.tables).length + Object.keys(REQ.views).length;

/** An unsigned JWT with the given payload; decodeJwtPayload reads only the middle part. */
function fakeJwt(payload: Record<string, string>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  return `${b64('{"alg":"none","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.sig`;
}
const STAGING_ANON_KEY = fakeJwt({ ref: STAGING_REF, role: 'anon' });
const STAGING_SERVICE_KEY = fakeJwt({ ref: STAGING_REF, role: 'service_role' });
/** A complete, non-production .env.loadtest, explicit so the real file cannot leak into the child. */
const STAGING_ENV: Record<string, string> = {
  STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  STAGING_SUPABASE_ANON_KEY: STAGING_ANON_KEY,
  STAGING_SERVICE_ROLE_KEY: STAGING_SERVICE_KEY,
  // Present so the Management API step runs deterministically against the fake.
  SUPABASE_ACCESS_TOKEN: 'sbp_not_a_real_token',
};

/** One line of the fake-Supabase request log. Only header *values the test chose* are recorded. */
type LoggedRequest = { url: string; apikey: string | null; authorization: string | null };

let fakeDir: string;
let emptyDir: string;
let fakeK6: string;
let noNetworkPreload: string;
let fakeSupabasePreload: string;
/** Never created: a dotenv path under the per-run temp dir, so LOADTEST_ENV_FILE resolves to nothing. */
let missingEnvFile: string;

function runPreflight(
  env: Record<string, string>,
  args: string[] = ['--stage', 'baseline'],
  preload: string = noNetworkPreload
) {
  // Scrub anything that could reach the network or a real target.
  const base: Record<string, string> = {};
  // Windows env keys are case-insensitive; when the caller overrides PATH,
  // drop the original Path/PATH so the two cannot coexist in the child.
  const overridesPath = Object.keys(env).some((k) => /^path$/i.test(k));
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(STAGING_|SUPABASE_|K6_BIN|CHAT_ROOM_ID|PARTY_ID|LOADTEST_ENV_FILE)/.test(k)) continue;
    if (overridesPath && /^path$/i.test(k)) continue;
    if (v !== undefined) base[k] = v;
  }
  // expo/types/global.d.ts makes NODE_ENV a required ProcessEnv member, so
  // the child env is built as a real NodeJS.ProcessEnv that carries the
  // parent's NODE_ENV through, rather than cast to one.
  const childEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ...base,
    LOCALAPPDATA: os.tmpdir(),
    // The script reloads its dotenv file after this scrub, so a developer's
    // real fan-wave-app/.env.loadtest would otherwise re-enter the child and
    // drive a schema fetch. Point it at a path that is guaranteed not to
    // exist; the target then comes only from the values a case passes in.
    LOADTEST_ENV_FILE: missingEnvFile,
    ...env,
  };
  // --require runs the CJS preload before the ESM entry is evaluated, so the
  // script (and _lib.mjs's requestJson) only ever see the throwing fetch.
  const res = spawnSync(process.execPath, ['--require', preload, SCRIPT, ...args], {
    encoding: 'utf8',
    env: childEnv,
    cwd: path.join(__dirname, '..'),
  });
  const out = `${res.stdout}\n${res.stderr}`;
  // The no-network contract, enforced for every case rather than assumed.
  expect(out).not.toContain(NO_NETWORK_MARK);
  return { status: res.status, out };
}

/**
 * Run against the in-process fake of Supabase and return, with the output,
 * every request the script made (URL plus the apikey / Authorization header
 * it sent) so a test can pin WHICH key was used without a socket.
 */
function runPreflightAgainstFake(env: Record<string, string>) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fetch-log-')), 'requests.jsonl');
  const { status, out } = runPreflight({ ...env, FW_FETCH_LOG: log }, ['--stage', 'baseline'], fakeSupabasePreload);
  const requests: LoggedRequest[] = fs.existsSync(log)
    ? fs
        .readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as LoggedRequest)
    : [];
  fs.rmSync(path.dirname(log), { recursive: true, force: true });
  return { status, out, requests };
}

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fake-k6-'));
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-empty-path-'));
  missingEnvFile = path.join(emptyDir, 'absent', '.env.loadtest');
  noNetworkPreload = path.join(fakeDir, 'no-network.cjs');
  fs.writeFileSync(
    noNetworkPreload,
    [
      '// Test preload: any network attempt from preflight.mjs fails fast and loudly.',
      'globalThis.fetch = async (input) => {',
      `  throw new Error('${NO_NETWORK_MARK}: fetch(' + String(input && input.url ? input.url : input) + ')');`,
      '};',
      '',
    ].join('\n')
  );
  // Fake of the only two endpoints the script may call. Anything else is a
  // no-network violation, exactly as in the default preload.
  fakeSupabasePreload = path.join(fakeDir, 'fake-supabase.cjs');
  fs.writeFileSync(
    fakeSupabasePreload,
    [
      '// Test preload: in-process fake of the Management API and PostgREST root; no socket is opened.',
      "const fs = require('fs');",
      "const path = require('path');",
      `const requirements = JSON.parse(fs.readFileSync(${JSON.stringify(REQUIREMENTS)}, 'utf8'));`,
      'function jwtRole(key) {',
      "  try { return JSON.parse(Buffer.from(String(key).split('.')[1], 'base64url').toString('utf8')).role; } catch { return null; }",
      '}',
      'function openApiFromRequirements() {',
      '  const definitions = {};',
      '  for (const [table, cols] of Object.entries({ ...requirements.tables, ...requirements.views })) {',
      '    definitions[table] = { properties: Object.fromEntries(cols.map((c) => [c, { type: "string" }])) };',
      '  }',
      '  const paths = Object.fromEntries(requirements.rpcs.map((fn) => [`/rpc/${fn}`, {}]));',
      '  return { definitions, paths };',
      '}',
      'const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });',
      'globalThis.fetch = async (input, init) => {',
      '  const url = String(input && input.url ? input.url : input);',
      '  const headers = new Headers((init && init.headers) || {});',
      "  const apikey = headers.get('apikey');",
      "  const authorization = headers.get('authorization');",
      "  fs.appendFileSync(process.env.FW_FETCH_LOG, JSON.stringify({ url, apikey, authorization }) + '\\n');",
      "  if (/^https:\\/\\/api\\.supabase\\.com\\/v1\\/projects\\/[a-z]+$/.test(url)) {",
      "    return json(200, { name: 'Fan Wave staging', status: 'ACTIVE_HEALTHY', region: 'ca-central-1', database: { version: '17.6' } });",
      '  }',
      "  if (/^https:\\/\\/[a-z]+\\.supabase\\.co\\/rest\\/v1\\/$/.test(url)) {",
      '    // As Supabase now behaves: the root OpenAPI document is served only to a secret key.',
      "    if (jwtRole(apikey) !== 'service_role') {",
      "      return json(401, { message: 'Secret API key required', hint: 'Only secret API keys can be used for this endpoint.' });",
      '    }',
      '    return json(200, openApiFromRequirements());',
      '  }',
      `  throw new Error('${NO_NETWORK_MARK}: fetch(' + url + ')');`,
      '};',
      '',
    ].join('\n')
  );
  if (process.platform === 'win32') {
    fakeK6 = path.join(fakeDir, 'k6.cmd');
    fs.writeFileSync(fakeK6, '@echo off\r\necho k6 v0.0.0-fake (go1.0, fake/amd64)\r\n');
  } else {
    fakeK6 = path.join(fakeDir, 'k6');
    fs.writeFileSync(fakeK6, '#!/bin/sh\necho "k6 v0.0.0-fake (go1.0, fake/amd64)"\n', { mode: 0o755 });
  }
});

afterAll(() => {
  fs.rmSync(fakeDir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });
});

describe('load-test preflight', () => {
  it('uses K6_BIN when it points at a working binary and says so', () => {
    const { out } = runPreflight({ K6_BIN: fakeK6 });
    expect(out).toMatch(/PASS\s+k6 k6 v0\.0\.0-fake.*via K6_BIN/);
    expect(out).not.toMatch(/BLOCK\s+k6 not found/);
  });

  it('blocks on a K6_BIN that does not exist instead of falling back', () => {
    const missing = path.join(fakeDir, 'nope', 'k6.exe');
    const { status, out } = runPreflight({ K6_BIN: missing });
    expect(status).toBe(1);
    expect(out).toMatch(/BLOCK\s+K6_BIN is set but .*does not exist/);
    expect(out).not.toMatch(/PASS\s+k6 /);
  });

  it('reports the install / K6_BIN unblock when no k6 can be found', () => {
    const { status, out } = runPreflight({ PATH: emptyDir });
    expect(status).toBe(1);
    expect(out).toMatch(/BLOCK\s+k6 not found \(K6_BIN unset/);
    expect(out).toMatch(/set K6_BIN=/);
  });

  /** Both remote sections must announce the skip and neither may have run. */
  function expectRemoteChecksSkipped(out: string) {
    expect(out).toMatch(/Project identity\r?\n\s+WARN\s+skipped; target is forbidden \(production\)/);
    expect(out).toMatch(/Schema \(tests\/load\/requirements\.json\)\r?\n\s+WARN\s+skipped; target is forbidden \(production\)/);
    // Lines only the live Management API / OpenAPI branches can print.
    expect(out).not.toMatch(/no ref to look up|SUPABASE_ACCESS_TOKEN not available|Management API returned|project .* is "|OpenAPI document|relations and|realtime publication/);
    // Local reporting still ran after the guard fired.
    expect(out).toMatch(/Data for profile "baseline"/);
  }

  it('refuses the production project ref even with k6 present and skips every remote check', () => {
    const { status, out } = runPreflight({
      ...STAGING_ENV,
      K6_BIN: fakeK6,
      STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      STAGING_SUPABASE_ANON_KEY: 'x',
      STAGING_SERVICE_ROLE_KEY: 'y',
      // SUPABASE_ACCESS_TOKEN present on purpose: the guard must skip the lookup even when it could run.
    });
    expect(status).toBe(1);
    expect(out).toMatch(/BLOCK\s+target ref fwlfiejvxmslkpoojggs IS PRODUCTION/);
    expectRemoteChecksSkipped(out);
    expect(out).toMatch(/BLOCKED/);
  });

  it('refuses a production anon key behind a staging URL and skips every remote check', () => {
    const { status, out } = runPreflight({
      ...STAGING_ENV,
      K6_BIN: fakeK6,
      STAGING_SUPABASE_ANON_KEY: fakeJwt({ ref: PROD_REF, role: 'anon' }),
    });
    expect(status).toBe(1);
    expect(out).toMatch(/PASS\s+target ref stagingrefabcdefghij is not the production ref/);
    expect(out).toMatch(/BLOCK\s+STAGING_SUPABASE_ANON_KEY belongs to PRODUCTION/);
    expectRemoteChecksSkipped(out);
    expect(out).toMatch(/BLOCKED/);
  });

  it('refuses a production service_role key behind a staging URL and skips every remote check', () => {
    // The service key now drives schema discovery, so its guard matters as
    // much as the anon key's: a prod secret must never reach GET /rest/v1/.
    const { status, out } = runPreflight({
      ...STAGING_ENV,
      K6_BIN: fakeK6,
      STAGING_SERVICE_ROLE_KEY: fakeJwt({ ref: PROD_REF, role: 'service_role' }),
    });
    expect(status).toBe(1);
    expect(out).toMatch(/PASS\s+STAGING_SUPABASE_ANON_KEY: role anon, ref matches, not production/);
    expect(out).toMatch(/BLOCK\s+STAGING_SERVICE_ROLE_KEY belongs to PRODUCTION/);
    expectRemoteChecksSkipped(out);
    expect(out).toMatch(/BLOCKED/);
  });

  describe('schema discovery key (GET /rest/v1/ answers only a secret key)', () => {
    it('reads the OpenAPI document with STAGING_SERVICE_ROLE_KEY and never sends the anon key', () => {
      const { out, requests } = runPreflightAgainstFake({ ...STAGING_ENV, K6_BIN: fakeK6 });
      // Both keys pass the target checks; the service key is required, not optional.
      expect(out).toMatch(/PASS\s+STAGING_SUPABASE_ANON_KEY: role anon, ref matches, not production/);
      expect(out).toMatch(/PASS\s+STAGING_SERVICE_ROLE_KEY: role service_role, ref matches, not production/);
      // The fake only serves the document to a service_role apikey, so this
      // PASS line can only be printed if the right key was sent.
      expect(out).toMatch(new RegExp(`PASS\\s+all ${RELATION_COUNT} relations and ${REQ.rpcs.length} RPCs present`));
      expect(out).not.toMatch(/OpenAPI document with the service_role key: HTTP/);
      // Pin the header values directly.
      const openApi = requests.filter((r) => r.url === `https://${STAGING_REF}.supabase.co/rest/v1/`);
      expect(openApi).toHaveLength(1);
      expect(openApi[0].apikey).toBe(STAGING_SERVICE_KEY);
      expect(openApi[0].authorization).toBe(`Bearer ${STAGING_SERVICE_KEY}`);
      expect(requests.some((r) => r.apikey === STAGING_ANON_KEY || r.authorization === `Bearer ${STAGING_ANON_KEY}`)).toBe(false);
      // Only the two expected endpoints were called, GET-only by construction of the script.
      expect(requests.map((r) => r.url).sort()).toEqual(
        [`https://api.supabase.com/v1/projects/${STAGING_REF}`, `https://${STAGING_REF}.supabase.co/rest/v1/`].sort()
      );
      // "It prints no key": neither key value may appear anywhere in the output.
      expect(out).not.toContain(STAGING_SERVICE_KEY);
      expect(out).not.toContain(STAGING_ANON_KEY);
    });

    it('blocks schema verification clearly when STAGING_SERVICE_ROLE_KEY is missing and does not fall back to the anon key', () => {
      const { status, out, requests } = runPreflightAgainstFake({ ...STAGING_ENV, K6_BIN: fakeK6, STAGING_SERVICE_ROLE_KEY: '' });
      expect(status).toBe(1);
      expect(out).toMatch(/BLOCK\s+STAGING_SERVICE_ROLE_KEY is not set; schema verification cannot run without it/);
      expect(out).toMatch(/fix: add it to \.env\.loadtest .*GET \/rest\/v1\/ answers only a secret key/);
      expect(out).toMatch(/Schema \(tests\/load\/requirements\.json\)\r?\n\s+WARN\s+skipped; needs STAGING_SUPABASE_URL and a usable STAGING_SERVICE_ROLE_KEY/);
      // The anon key is still validated for k6, but it must not be used to read the schema.
      expect(out).toMatch(/PASS\s+STAGING_SUPABASE_ANON_KEY: role anon, ref matches, not production/);
      expect(requests.some((r) => r.url.endsWith('/rest/v1/'))).toBe(false);
      // The Management API lookup is independent of the service key and still ran.
      expect(out).toMatch(/PASS\s+project stagingrefabcdefghij is "Fan Wave staging"/);
      expect(out).toMatch(/BLOCKED/);
    });

    it('surfaces the 401 "Secret API key required" when a non-secret key is pasted into STAGING_SERVICE_ROLE_KEY', () => {
      // A publishable key is not a JWT, so the claim checks cannot catch the
      // mix-up; the fake answers it exactly as Supabase did on 2026-10-04.
      const { status, out, requests } = runPreflightAgainstFake({
        ...STAGING_ENV,
        K6_BIN: fakeK6,
        STAGING_SERVICE_ROLE_KEY: 'sb_publishable_not_a_secret',
      });
      expect(status).toBe(1);
      expect(out).toMatch(/WARN\s+STAGING_SERVICE_ROLE_KEY is not a JWT/);
      expect(out).toMatch(/BLOCK\s+OpenAPI document with the service_role key: HTTP 401 \(Secret API key required\)/);
      expect(out).toMatch(/fix: check the URL \/ STAGING_SERVICE_ROLE_KEY; GET \/rest\/v1\/ is served only to a secret API key/);
      const openApi = requests.filter((r) => r.url.endsWith('/rest/v1/'));
      expect(openApi).toHaveLength(1);
      expect(openApi[0].apikey).toBe('sb_publishable_not_a_secret');
      expect(out).toMatch(/BLOCKED/);
    });
  });
});
