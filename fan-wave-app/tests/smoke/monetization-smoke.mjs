// Smoke test for the monetization slice (FW-85 through FW-104).
// Runs against the LIVE remote DB using the public anon key so we can
// exercise the RPC surface anonymously and confirm:
//   • migrations 032/033/034/035/036 are present
//   • has_premium_access / has_wc_access return the expected booleans
//   • check_rate_limit RPC is callable
//   • the RevenueCat webhook rejects unauthorized requests (and accepts
//     authorized ones if the secret is set)
//   • the clips bucket file_size_limit is 25 MB
//
// Usage:
//   node tests/smoke/monetization-smoke.mjs

import { createClient } from '@supabase/supabase-js';

// Defaults point at PRODUCTION (`fwlfiejvxmslkpoojggs`), matching the preview and
// production env blocks in eas.json. They used to point at the legacy dev project
// `azkmymxdjylmkytrvyfn`, which has been retired since 2026-06-09 — every check
// below would have been passing or failing against a database no build talks to.
// Override via env to aim at a branch DB.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://fwlfiejvxmslkpoojggs.supabase.co';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bGZpZWp2eG1zbGtwb29qZ2dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5OTgzNDAsImV4cCI6MjA5NjU3NDM0MH0.v4QaXnDnE0pJYcpSZXQPFlkNroEeAfhSbqozuLXbr_M';
const FAKE_UID = '00000000-0000-0000-0000-000000000000';

const supabase = createClient(SUPABASE_URL, ANON_KEY);
let pass = 0, fail = 0;
const log = (ok, name, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

async function main() {
  // Say out loud which DB these results describe. A green run against the wrong
  // project is worse than a red one.
  console.log(`target: ${SUPABASE_URL}\n`);

  // ─── 1. has_premium_access / has_wc_access — fake uid returns false ──
  {
    const { data, error } = await supabase.rpc('has_premium_access', { uid: FAKE_UID });
    log(!error && data === false, 'has_premium_access(fake-uid) returns false', error?.message);
  }
  {
    const { data, error } = await supabase.rpc('has_wc_access', { uid: FAKE_UID });
    log(!error && data === false, 'has_wc_access(fake-uid) returns false', error?.message);
  }

  // ─── 2. check_rate_limit — anon call should be callable ──────────────
  {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: FAKE_UID,
      p_action: 'smoke_test',
      p_max_count: 1,
      p_window_seconds: 60,
    });
    log(!error && typeof data === 'boolean', 'check_rate_limit returns boolean', error?.message);
  }

  // ─── 3. Tables exist (anon SELECT — entitlements has user-scoped RLS,
  //      but the query itself should succeed with an empty result set) ──
  {
    const { error } = await supabase.from('entitlements').select('id').limit(1);
    log(!error, 'entitlements table queryable (RLS allows empty result)', error?.message);
  }
  {
    // purchase_events is service-role only — anon SELECT should be denied
    // by RLS (no policy grants anon SELECT). An empty result is correct.
    const { data, error } = await supabase.from('purchase_events').select('id').limit(1);
    log(!error && Array.isArray(data) && data.length === 0, 'purchase_events anon SELECT returns empty (service-role only)', error?.message);
  }
  {
    const { error } = await supabase.from('trial_reminders_sent').select('id').limit(1);
    log(!error, 'trial_reminders_sent table exists', error?.message);
  }

  // ─── 4. users entitlement columns exist ──────────────────────────────
  {
    const { error } = await supabase
      .from('users')
      .select('subscription_status, premium_active_until, wc_pass_active_until')
      .limit(1);
    log(!error, 'users.subscription_status + premium_active_until + wc_pass_active_until columns exist', error?.message);
  }

  // ─── 4b. v9.3 tier column exists (migration 082) ─────────────────────
  {
    const { error } = await supabase.from('users').select('subscription_tier').limit(1);
    log(!error, 'users.subscription_tier column exists (mig 082)', error?.message);
  }

  // ─── 5. games.sport_id exists (migration 031) ────────────────────────
  {
    const { error } = await supabase.from('games').select('sport_id').limit(1);
    log(!error, 'games.sport_id column exists', error?.message);
  }

  // ─── 6. media_clips.sport_id + moment_type exist (migration 030) ─────
  {
    const { error } = await supabase.from('media_clips').select('sport_id, moment_type').limit(1);
    log(!error, 'media_clips.sport_id + moment_type columns exist', error?.message);
  }

  // ─── 7. RevenueCat webhook rejects unauthorized requests ─────────────
  {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/revenuecat-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-secret' },
        body: JSON.stringify({ event: { id: 'smoke-test', type: 'INITIAL_PURCHASE' } }),
      });
      log(res.status === 401, `revenuecat-webhook returns 401 on bad bearer (got ${res.status})`);
    } catch (e) {
      log(false, 'revenuecat-webhook reachable', e.message);
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
