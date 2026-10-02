/**
 * scripts/load/preflight.mjs is the read-only gate before any k6 run. These
 * tests drive it as a child process and pin three things:
 *   - k6 resolution honours K6_BIN (a missing K6_BIN is a blocker, never a
 *     silent fallback) and reports which binary it will use;
 *   - the production guard blocks: a prod ref in the URL, or a prod `ref`
 *     claim in a key, is refused even when every other input is fine;
 *   - a forbidden target short-circuits EVERY remote check: the Management
 *     API and OpenAPI steps report themselves skipped and nothing is sent.
 *
 * No case may touch the network. The child is started with a --require
 * preload that replaces globalThis.fetch with a function that throws a
 * recognisable error, and runPreflight() fails the test if that error ever
 * appears in the output; the no-network contract is therefore enforced, not
 * assumed. (The script relies on process.exitCode rather than process.exit(1)
 * because on Node 24 / Windows an abrupt exit right after a real fetch()
 * crashes with UV_HANDLE_CLOSING, exit 3221226505; that path is not exercised
 * here because no fetch happens, but `status === 1` pins the clean exit.)
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

/** An unsigned JWT with the given payload; decodeJwtPayload reads only the middle part. */
function fakeJwt(payload: Record<string, string>) {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  return `${b64('{"alg":"none","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.sig`;
}

let fakeDir: string;
let emptyDir: string;
let fakeK6: string;
let noNetworkPreload: string;

function runPreflight(env: Record<string, string>, args: string[] = ['--stage', 'baseline']) {
  // Scrub anything that could reach the network or a real target.
  const base: Record<string, string> = {};
  // Windows env keys are case-insensitive; when the caller overrides PATH,
  // drop the original Path/PATH so the two cannot coexist in the child.
  const overridesPath = Object.keys(env).some((k) => /^path$/i.test(k));
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(STAGING_|SUPABASE_|K6_BIN|CHAT_ROOM_ID|PARTY_ID)/.test(k)) continue;
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
    ...env,
  };
  // --require runs the CJS preload before the ESM entry is evaluated, so the
  // script (and _lib.mjs's requestJson) only ever see the throwing fetch.
  const res = spawnSync(process.execPath, ['--require', noNetworkPreload, SCRIPT, ...args], {
    encoding: 'utf8',
    env: childEnv,
    cwd: path.join(__dirname, '..'),
  });
  const out = `${res.stdout}\n${res.stderr}`;
  // The no-network contract, enforced for every case rather than assumed.
  expect(out).not.toContain(NO_NETWORK_MARK);
  return { status: res.status, out };
}

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fake-k6-'));
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-empty-path-'));
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
      K6_BIN: fakeK6,
      STAGING_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      STAGING_SUPABASE_ANON_KEY: 'x',
      // Present on purpose: the guard must skip the lookup even when it could run.
      SUPABASE_ACCESS_TOKEN: 'sbp_not_a_real_token',
    });
    expect(status).toBe(1);
    expect(out).toMatch(/BLOCK\s+target ref fwlfiejvxmslkpoojggs IS PRODUCTION/);
    expectRemoteChecksSkipped(out);
    expect(out).toMatch(/BLOCKED/);
  });

  it('refuses a production anon key behind a staging URL and skips every remote check', () => {
    const { status, out } = runPreflight({
      K6_BIN: fakeK6,
      STAGING_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      STAGING_SUPABASE_ANON_KEY: fakeJwt({ ref: PROD_REF, role: 'anon' }),
      SUPABASE_ACCESS_TOKEN: 'sbp_not_a_real_token',
    });
    expect(status).toBe(1);
    expect(out).toMatch(/PASS\s+target ref stagingrefabcdefghij is not the production ref/);
    expect(out).toMatch(/BLOCK\s+STAGING_SUPABASE_ANON_KEY belongs to PRODUCTION/);
    expectRemoteChecksSkipped(out);
    expect(out).toMatch(/BLOCKED/);
  });
});
