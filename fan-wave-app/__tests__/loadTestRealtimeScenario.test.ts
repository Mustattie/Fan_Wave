/**
 * tests/load/realtime-ws.js contract test: graceful ramp-down, thresholds, session defaults.
 *
 * Validates that:
 *   - SESSION_SECONDS defaults to 120
 *   - gracefulRampDown formula is Math.ceil(Math.max(10, SESSION_SECONDS) + 15)
 *   - default grace (135s) safely exceeds worst-case full iteration (~124s)
 *   - thresholds remain: rate<0.005, rate>0.99, rate>=0.99
 *   - gracefulRampDown is not hard-coded 30s and does not reference PROFILE.rampDown
 */
import fs from 'fs';
import path from 'path';

const LOAD_DIR = path.join(__dirname, '..', 'tests', 'load');
const SCRIPT = path.join(LOAD_DIR, 'realtime-ws.js');
const CONFIG = path.join(LOAD_DIR, 'lib', 'config.js');
const src = fs.readFileSync(SCRIPT, 'utf8');
const cfg = fs.readFileSync(CONFIG, 'utf8');

describe('realtime-ws k6 harness contract', () => {
  it('SESSION_SECONDS defaults to 120', () => {
    // Line 48: const SESSION_SECONDS = Number(__ENV.SESSION_SECONDS || 120);
    expect(src).toMatch(/const SESSION_SECONDS = Number\(__ENV\.SESSION_SECONDS \|\| 120\)/);
  });

  it('gracefulRampDown is derived from SESSION_SECONDS, not hard-coded 30s', () => {
    // Must use Math.max and Math.ceil, not a static value.
    expect(src).toMatch(/const GRACEFUL_RAMP_DOWN_SECONDS = Math\.ceil\(Math\.max\(10, SESSION_SECONDS\) \+ 15\)/);

    // Verify 30s does not appear as a hard-coded graceful ramp-down.
    const hardcodedLines = src.split('\n').filter((line) =>
      /gracefulRampDown|rampDown|30\s*s/i.test(line) && line.includes("'30s'")
    );
    expect(hardcodedLines.length).toBe(0);
  });

  it('gracefulRampDown references the derived constant, not PROFILE.rampDown', () => {
    const optionsBlock = /export const options = \{([\s\S]*?)\n\};/.exec(src);
    expect(optionsBlock).toBeTruthy();
    const blockContent = optionsBlock![1];

    // Must use the derived constant.
    expect(blockContent).toMatch(/gracefulRampDown:\s*`\$\{GRACEFUL_RAMP_DOWN_SECONDS\}s`/);

    // Must not reference PROFILE.rampDown.
    expect(blockContent).not.toMatch(/PROFILE\.rampDown/);
  });

  describe('grace formula safety', () => {
    function gracefulRampDownSeconds(sessionSeconds: number): number {
      return Math.ceil(Math.max(10, sessionSeconds) + 15);
    }

    function iterationDurationSeconds(sessionSeconds: number): number {
      const half = Math.max(5000, (sessionSeconds * 1000) / 2);
      const jitterMs = 3000; // up to 3s
      const sleepMs = 1000; // 1s final sleep
      return (half + jitterMs + half + sleepMs) / 1000;
    }

    it('default grace (120s session) exceeds worst-case iteration', () => {
      const SESSION_SECONDS = 120;
      const grace = gracefulRampDownSeconds(SESSION_SECONDS);
      const iteration = iterationDurationSeconds(SESSION_SECONDS);

      // half = max(5s, 120/2) = 60s; iteration ≈ 60 + 3 + 60 + 1 = 124s
      expect(iteration).toBeCloseTo(124, 0);

      // grace = ceil(max(10, 120) + 15) = 135s
      expect(grace).toBe(135);

      expect(grace).toBeGreaterThan(iteration);
      expect(grace - iteration).toBeGreaterThanOrEqual(10);
    });

    it('short sessions (10s) get at least 10s buffer', () => {
      const SESSION_SECONDS = 10;
      const grace = gracefulRampDownSeconds(SESSION_SECONDS);
      const iteration = iterationDurationSeconds(SESSION_SECONDS);

      // half = max(5, 10/2) = 5s; iteration ≈ 5 + 3 + 5 + 1 = 14s
      expect(iteration).toBeCloseTo(14, 0);

      // grace = ceil(max(10, 10) + 15) = 25s
      expect(grace).toBe(25);

      expect(grace - iteration).toBeGreaterThanOrEqual(10);
    });

    it('grace is always at least 25s', () => {
      // Math.max(10, x) ensures grace ≥ ceil(10 + 15) = 25
      for (const s of [1, 5, 10, 30, 120, 300, 600]) {
        const grace = gracefulRampDownSeconds(s);
        expect(grace).toBeGreaterThanOrEqual(25);
      }
    });
  });

  describe('threshold gates', () => {
    function extractThresholds(): Record<string, string[]> {
      // Extract THRESHOLDS object from config.js
      const block = /export const THRESHOLDS = \{([\s\S]*?)\n\};/.exec(cfg);
      expect(block).toBeTruthy();
      const out: Record<string, string[]> = {};
      const re = /(\w+):\s*\{\s*(\w+):\s*\[(.*?)\]\s*\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block![1]))) {
        const metric = m[2];
        const thresholds = m[3]
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter((s) => s);
        out[metric] = thresholds;
      }
      return out;
    }

    it('ws_connect_errors threshold is rate<0.005', () => {
      const thresholds = extractThresholds();
      expect(thresholds.ws_connect_errors).toBeTruthy();
      expect(thresholds.ws_connect_errors).toContain('rate<0.005');
    });

    it('ws_join_ok threshold is rate>0.99', () => {
      const thresholds = extractThresholds();
      expect(thresholds.ws_join_ok).toBeTruthy();
      expect(thresholds.ws_join_ok).toContain('rate>0.99');
    });

    it('ws_rejoin_within_10s threshold is rate>=0.99', () => {
      const thresholds = extractThresholds();
      expect(thresholds.ws_rejoin_within_10s).toBeTruthy();
      expect(thresholds.ws_rejoin_within_10s).toContain('rate>=0.99');
    });

    it('merges the three ws thresholds in options', () => {
      const optionsBlock = /export const options = \{([\s\S]*?)\n\};/.exec(src);
      expect(optionsBlock).toBeTruthy();
      const blockContent = optionsBlock![1];

      // Must call mergeThresholds with all three
      expect(blockContent).toMatch(
        /mergeThresholds\([^)]*THRESHOLDS\.wsConnect[^)]*THRESHOLDS\.wsJoin[^)]*THRESHOLDS\.rejoin/s
      );
    });
  });

  describe('socket semantics', () => {
    it('preserves runSocket() and its join/reconnect logic', () => {
      // The function exists and creates Phoenix join messages.
      expect(src).toMatch(/function runSocket\(jwt, holdMs, label\)/);
      expect(src).toMatch(/phx_join/);
      expect(src).toMatch(/socket\.on\('open'/);
      expect(src).toMatch(/socket\.on\('message'/);
      expect(src).toMatch(/socket\.on\('error'/);
    });

    it('measures reconnect within REJOIN_BUDGET_MS (10s)', () => {
      expect(src).toMatch(/const REJOIN_BUDGET_MS = 10000/);
      expect(src).toMatch(/rejoinWithin10s\.add.*REJOIN_BUDGET_MS/);
    });

    it('runs two socket holds in default() separated by jittered sleep', () => {
      const body = /export default function \(data\) \{([\s\S]*?)\n\}/.exec(src);
      expect(body).toBeTruthy();
      const bodyContent = body![1];

      // Two runSocket() calls
      const runSocketCalls = bodyContent.match(/runSocket\(/g) || [];
      expect(runSocketCalls.length).toBe(2);

      // Jittered sleep between them: 1 + Math.random() * 2
      expect(bodyContent).toMatch(/sleep\(1 \+ Math\.random\(\) \* 2\)/);
    });
  });

  it('documents the half-hold formula in comments', () => {
    // Comment must explain: full iteration = two half-holds totaling max(10, SESSION_SECONDS) + jitter + sleep + buffer
    expect(src).toMatch(/two half-holds.*max\(10, SESSION_SECONDS\).*\+15.*buffer/s);
  });
});
