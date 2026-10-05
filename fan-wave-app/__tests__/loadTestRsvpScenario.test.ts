/**
 * tests/load/watch-party-rsvp.js measures simultaneous-RSVP row-lock and
 * capacity concurrency, not abuse rate. Migration 103 caps watch_party_rsvps
 * INSERTs at 20 per user per DAY (free tier, 86 400 s window), so a looping
 * going→none toggle exhausts the budget mid-run and the rest of the run is
 * PT429 noise (seen on staging: 1,000 successes = 50 users × 20, then 2,138
 * 429s at baseline). This pins the shape that avoids that and keeps the
 * committed arrival model:
 *
 *   - per-vu-iterations, PROFILE.vus VUs, exactly one iteration each;
 *   - one going → none cycle per VU, short dwell between them;
 *   - each VU staggered linearly across shrink(PROFILE.ramp, 3) before its
 *     "going" call (baseline 50 over 20 s, campus 300 over 60 s, spike 600
 *     over 10 s), with no env override that could widen the window;
 *   - strict gates: rsvp_ok rate==1 on both calls, rsvp_latency p95 < 1 s,
 *     errors < 1 % stop rule.
 *
 * k6 is not installed in CI, so this is a static contract on the source,
 * plus direct evaluation of the two pure helpers it extracts.
 */
import fs from 'fs';
import path from 'path';

const LOAD_DIR = path.join(__dirname, '..', 'tests', 'load');
const SCRIPT = path.join(LOAD_DIR, 'watch-party-rsvp.js');
const CONFIG = path.join(LOAD_DIR, 'lib', 'config.js');
const src = fs.readFileSync(SCRIPT, 'utf8');
const cfg = fs.readFileSync(CONFIG, 'utf8');

function scenarioBlock(): string {
  const m = /rsvp_burst:\s*\{([\s\S]*?)\n\s{4}\},/.exec(src);
  if (!m) throw new Error('rsvp_burst scenario block not found');
  return m[1];
}

function defaultBody(): string {
  const i = src.indexOf('export default function');
  if (i < 0) throw new Error('default function not found');
  return src.slice(i);
}

/** Pull a top-level `function name(...) { ... }` out of the script and evaluate it. */
function extractFunction<T extends (...args: never[]) => unknown>(name: string): T {
  const re = new RegExp(`\\nfunction ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`);
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name} not found in watch-party-rsvp.js`);
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return ${name};`)() as T;
}

/** The three college profiles as written in lib/config.js. */
function collegeProfiles(): Record<string, { vus: number; ramp: string }> {
  const block = /COLLEGE_PROFILES = \{([\s\S]*?)\n\};/.exec(cfg);
  if (!block) throw new Error('COLLEGE_PROFILES not found in config.js');
  const out: Record<string, { vus: number; ramp: string }> = {};
  const re = /(\w+):\s*\{\s*vus:\s*(\d+),\s*ramp:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) out[m[1]] = { vus: Number(m[2]), ramp: m[3] };
  return out;
}

type Shrink = (duration: string, factor: number) => string;
type Stagger = (vu: number, vus: number, windowSeconds: number) => number;

describe('watch-party-rsvp k6 scenario contract', () => {
  it('launches the selected profile with one iteration per VU (no ramping-vus, no loop)', () => {
    const block = scenarioBlock();
    expect(block).toMatch(/executor:\s*'per-vu-iterations'/);
    expect(block).toMatch(/vus:\s*PROFILE\.vus/);
    expect(block).toMatch(/iterations:\s*1\b/);
    expect(block).toMatch(/maxDuration:\s*'\d+[sm]'/);
    // No ramping-vus executor anywhere in the options, and the shared
    // rampingStages() helper is not imported (the ramp is the stagger).
    expect(block).not.toMatch(/ramping-vus|startVUs|stages:/);
    expect(src).not.toMatch(/executor:\s*'ramping-vus'|rampingStages/);
  });

  it('runs exactly one going → none cycle per VU with a short dwell between', () => {
    const body = defaultBody();
    const going = body.match(/p_status:\s*'going'/g) || [];
    const cancel = body.match(/p_status:\s*'none'/g) || [];
    expect(going).toHaveLength(1);
    expect(cancel).toHaveLength(1);
    const goingAt = body.indexOf("p_status: 'going'");
    const cancelAt = body.indexOf("p_status: 'none'");
    expect(goingAt).toBeLessThan(cancelAt);
    // The dwell sits between the two RPCs and is the short think(2, 1).
    const between = body.slice(goingAt, cancelAt);
    expect(between).toMatch(/sleep\(think\(2,\s*1\)\)/);
    // No trailing sleep after the cancel, and no loop of any kind.
    expect(body.slice(cancelAt)).not.toMatch(/sleep\(/);
    expect(body).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/);
  });

  describe('arrival model: linear stagger across shrink(PROFILE.ramp, 3)', () => {
    const shrink = extractFunction<Shrink>('shrink');
    const staggerSeconds = extractFunction<Stagger>('staggerSeconds');

    it('keeps the committed shrink(): a third of the ramp, floored at 10 s', () => {
      expect(shrink('1m', 3)).toBe('20s');
      expect(shrink('3m', 3)).toBe('60s');
      expect(shrink('10s', 3)).toBe('10s'); // 3.33 s floors to the 10 s minimum
      expect(shrink('5m', 3)).toBe('100s');
      expect(shrink('bogus', 3)).toBe('bogus');
    });

    it('derives the window from the profile ramp only, parsed to seconds', () => {
      expect(src).toMatch(/const ARRIVAL_WINDOW = shrink\(PROFILE\.ramp, 3\);/);
      expect(src).toMatch(/const ARRIVAL_WINDOW_SECONDS = parseDurationSeconds\(ARRIVAL_WINDOW\);/);
      expect(src).toMatch(/\bparseDurationSeconds,\n/); // imported from lib/config.js
      // No env knob may widen (or narrow) the window: the script reads no
      // __ENV at all; every setting comes from lib/config.js's profile.
      expect(src).not.toMatch(/__ENV/);
      expect(src).not.toMatch(/STAGGER_|ARRIVAL_OVERRIDE|RSVP_WINDOW/i);
    });

    it('sleeps the stagger before the going RPC, keyed on the unique 1-based __VU', () => {
      const body = defaultBody();
      const sleepAt = body.indexOf('sleep(staggerSeconds(__VU, PROFILE.vus, ARRIVAL_WINDOW_SECONDS))');
      const goingAt = body.indexOf("p_status: 'going'");
      expect(sleepAt).toBeGreaterThan(-1);
      expect(sleepAt).toBeLessThan(goingAt);
      // Nothing is sent before the stagger: no rpc( between the function
      // header and the stagger sleep.
      expect(body.slice(0, sleepAt)).not.toMatch(/\brpc\(/);
    });

    it('is linear: VU 1 at 0 s, VU n at (n-1)*window/vus, last VU inside the window', () => {
      expect(staggerSeconds(1, 50, 20)).toBe(0);
      expect(staggerSeconds(2, 50, 20)).toBeCloseTo(0.4, 10);
      expect(staggerSeconds(26, 50, 20)).toBeCloseTo(10, 10);
      expect(staggerSeconds(50, 50, 20)).toBeCloseTo(19.6, 10);
      // Monotonic and evenly spaced.
      const gaps = Array.from({ length: 49 }, (_, i) =>
        staggerSeconds(i + 2, 50, 20) - staggerSeconds(i + 1, 50, 20),
      );
      for (const g of gaps) expect(g).toBeCloseTo(0.4, 10);
    });

    it.each([
      ['baseline', 50, '1m', '20s', 20],
      ['campus', 300, '3m', '60s', 60],
      ['spike', 600, '10s', '10s', 10],
    ])(
      '%s: %i VUs spread across %s / 3 = %s',
      (name, vus, ramp, window, windowSeconds) => {
        const profiles = collegeProfiles();
        expect(profiles[name]).toEqual({ vus, ramp }); // lib/config.js still says so
        expect(shrink(ramp, 3)).toBe(window);
        expect(staggerSeconds(1, vus, windowSeconds)).toBe(0);
        const last = staggerSeconds(vus, vus, windowSeconds);
        expect(last).toBeCloseTo(windowSeconds - windowSeconds / vus, 10);
        expect(last).toBeLessThan(windowSeconds);
        expect(staggerSeconds(2, vus, windowSeconds)).toBeCloseTo(windowSeconds / vus, 10);
      },
    );
  });

  it('gates both the going and the cancel on strict 2xx (429 is a failure, not rate_limited)', () => {
    expect(src).toMatch(/const rsvpOk = new Rate\('rsvp_ok'\)/);
    expect(src).toMatch(/function is2xx\(res\)\s*\{\s*return res\.status >= 200 && res\.status < 300;/);
    expect(src).toMatch(/rsvpOk\.add\(is2xx\(going\)\)/);
    expect(src).toMatch(/rsvpOk\.add\(is2xx\(cancel\)\)/);
    expect(src).toMatch(/rsvp_ok:\s*\['rate==1'\]/);
    // No carve-out that would let a 429 pass as an acceptable RSVP result.
    expect(src).not.toMatch(/status\s*!==?\s*429|isRateLimited|rateLimited/);
  });

  it('preserves the shared 1 s p95 latency gate and the error stop rule', () => {
    expect(src).toMatch(/new Trend\('rsvp_latency', true\)/);
    expect(src).toMatch(/mergeThresholds\(\s*THRESHOLDS\.rsvp,\s*THRESHOLDS\.errors,/);
    expect(cfg).toMatch(/rsvp:\s*\{\s*rsvp_latency:\s*\['p\(95\)<1000'\]\s*\}/);
    expect(cfg).toMatch(/errors:\s*\{\s*errors:\s*\[\{\s*threshold:\s*'rate<0\.01',\s*abortOnFail:\s*true/);
  });

  it('documents the migration 103 RSVP ceiling as 20 per user per day, not per hour', () => {
    expect(src).toMatch(/20 per user per DAY/);
    expect(src).not.toMatch(/per hour|hourly|20\/hour/i);
    // migration 103 itself: rsvp 20 / 86400 (free) -> 100 / 86400 (paid).
    const mig = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations', '103_rate_limit_server_ceilings.sql'),
      'utf8',
    );
    expect(mig).toMatch(/rsvp,\s+watch_party_rsvps_insert\s+20 \/ 86400\s+->\s+100 \/ 86400/);
  });
});
