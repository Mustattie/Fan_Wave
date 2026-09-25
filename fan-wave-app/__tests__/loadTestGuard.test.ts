/**
 * tests/load/lib/config.js is imported by every k6 scenario and throws in
 * the init context if the target is production. That guard is the only
 * thing standing between a typo in --env and a load test against real
 * users, so it is pinned here. k6 itself is not installed in CI; the
 * module only depends on the `__ENV` global, so Jest can load it directly.
 */

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function fakeJwt(payload: object): string {
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

const PROD_REF = 'fwlfiejvxmslkpoojggs';
const STAGING_REF = 'abcdefghijklmnopqrst';

function loadConfig(env: Record<string, string>) {
  (globalThis as any).__ENV = env;
  let mod: any;
  jest.isolateModules(() => {
    mod = require('../tests/load/lib/config.js');
  });
  return mod;
}

afterEach(() => {
  delete (globalThis as any).__ENV;
});

describe('k6 load config production guard', () => {
  it('refuses a SUPABASE_URL that names the production project', () => {
    expect(() =>
      loadConfig({ SUPABASE_URL: `https://${PROD_REF}.supabase.co`, SUPABASE_ANON_KEY: 'anything' }),
    ).toThrow(/PRODUCTION project ref/);
  });

  it('refuses an anon key whose JWT ref is production even with a staging URL', () => {
    expect(() =>
      loadConfig({
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_ANON_KEY: fakeJwt({ ref: PROD_REF, role: 'anon' }),
      }),
    ).toThrow(/belongs to the PRODUCTION project/);
  });

  it('refuses a service_role key', () => {
    expect(() =>
      loadConfig({
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_ANON_KEY: fakeJwt({ ref: STAGING_REF, role: 'service_role' }),
      }),
    ).toThrow(/service_role/);
  });

  it('refuses an empty URL, a non-https URL and an empty key', () => {
    expect(() => loadConfig({ SUPABASE_URL: '', SUPABASE_ANON_KEY: 'k' })).toThrow(/empty/);
    expect(() =>
      loadConfig({ SUPABASE_URL: `http://${STAGING_REF}.supabase.co`, SUPABASE_ANON_KEY: 'k' }),
    ).toThrow(/https/);
    expect(() =>
      loadConfig({ SUPABASE_URL: `https://${STAGING_REF}.supabase.co`, SUPABASE_ANON_KEY: '' }),
    ).toThrow(/ANON_KEY is empty/);
  });

  it('accepts a staging anon key and exposes the stage profile', () => {
    const cfg = loadConfig({
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co/`,
      SUPABASE_ANON_KEY: fakeJwt({ ref: STAGING_REF, role: 'anon' }),
      STAGE: '3',
    });
    expect(cfg.SUPABASE_URL).toBe(`https://${STAGING_REF}.supabase.co`);
    expect(cfg.STAGE).toBe(3);
    expect(cfg.PROFILE.vus).toBe(1000);
    expect(cfg.profileDurationSeconds()).toBe(9 * 60);
    expect(cfg.REALTIME_WS_URL).toBe(`wss://${STAGING_REF}.supabase.co/realtime/v1/websocket`);
  });

  it('rejects an out-of-range STAGE', () => {
    expect(() =>
      loadConfig({
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_ANON_KEY: fakeJwt({ ref: STAGING_REF, role: 'anon' }),
        STAGE: '9',
      }),
    ).toThrow(/STAGE must be 1..5/);
  });
});
