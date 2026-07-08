# Pre-EAS-Build Gate Checklist

**Purpose.** Every EAS build costs real money. From v6 through v8.4 we have
shipped EIGHT consecutive builds that failed UAT and required a hotfix
cycle. The pattern: code changes shipped without ever being walked
through on a real device, silent failures that look like success, and
fixes that only addressed symptoms.

This document is the **GATE**, not the UAT plan. You run this BEFORE
`eas build`. If any phase is RED, the build does not get sent.

Total time when everything is green: **~45 min**. Cost of one failed
EAS build cycle + hotfix + re-build: hours of work + double the EAS
credits + a tester-burn event. The math is obvious.

---

## How to use this document

1. Open this file at the top of every build cycle.
2. Work top to bottom. Each phase has a **time-box** and a **PASS criterion**.
3. When a phase passes, paste the evidence (command output, screenshot
   path, SQL result) into the build notes below.
4. If anything is RED, you do NOT proceed to the next phase. Fix the
   underlying issue first.
5. The Go / No-Go decision at Phase 6 is binary. There is no "ship with
   known issues" path — every "known issue" we shipped came back as a
   UAT regression that cost more than the fix.

---

## PHASE 0 — v9.0 Pivot Sanity (5 min)

The v9.0 pivot removed the Soccer Cup tab, folded Fan Groups into
Discover, and added the Game Day tab. Every future v9.x build must
still pass these — a regression here means the pivot itself broke.
Run these BEFORE the older triage / static gates so pivot fallout is
caught first.

### 0.1 — Tab bar shape

- [ ] Bottom tab bar shows **exactly 5 tabs, in this order**:
      Home, Discover, Game Day, Clips, Profile.
- [ ] No "Soccer Cup" tab is visible.
- [ ] No standalone "Groups" tab is visible (Groups now lives inside
      Discover).

### 0.2 — Game Day tab renders empty-state clean

- [ ] Game Day tab opens without a crash or ErrorBoundary fallback.
- [ ] Sport pill row is visible at the top.
- [ ] "Live now" section header is visible even when there are no live
      games (empty-state copy, not a blank screen).
- [ ] "Upcoming today" section header is visible even when the list is
      empty.

### 0.3 — Discover: Fan Groups section

- [ ] Discover shows a "Fan Groups" section header.
- [ ] Under that header, both **Joined** and **Suggested** sub-tabs are
      present and tappable.
- [ ] A "+ Create" button is visible in the Fan Groups section.
- [ ] Tapping "+ Create" opens the create-group modal, or navigates to
      `/create-group` (per Agent F's implementation choice). Either
      behaviour is acceptable; a crash or dead tap is NOT.

### 0.4 — Removed routes fail safely

Deep-link into each of these from a fresh cold start (adb shell am
start -a android.intent.action.VIEW -d "fansphere://..." for each):

- [ ] `/(tabs)/world-cup` — does NOT crash. Lands on `+not-found`,
      Discover, or another sensible fallback.
- [ ] `/(tabs)/groups` — does NOT crash. Same fallback rules.
- [ ] `/create-wc-group` — does NOT crash. Same fallback rules.

### 0.5 — Backward-compat DB reads

```sql
-- The wc_pass_active_until column must still be readable even though
-- WC Pass is no longer sold. Old rows in prod still reference it.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND column_name  = 'wc_pass_active_until';
```
- [ ] Column exists. Any code path that reads it still compiles / runs
      without throwing (grep the diff for `wc_pass_active_until`).

### 0.6 — Pivot migrations applied

```sql
-- Migration 065 — pivot schema changes. Idempotent, safe to replay.
SELECT name, executed_at
FROM supabase_migrations.schema_migrations
WHERE name LIKE '065%'
ORDER BY executed_at DESC LIMIT 5;

-- Migration 066 — disables the WC-fast ESPN cron job.
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'espn_sync_worldcup_fast';
```
- [ ] Migration 065 rows returned against prod OR local dev DB (the DB
      the EAS build will point at).
- [ ] Migration 066 rows returned AND `espn_sync_worldcup_fast` shows
      `active = false`. If the row is missing entirely, 066 has not
      run — do not build.

**PASS criterion:** every box in 0.1–0.6 checked. If any single box is
red, the pivot itself is broken and no downstream phase matters.

---

## PHASE 1 — Triage (5 min)

The cheapest gate is asking yourself the right questions before you do
anything else.

- [ ] **Read your own diff.** `git diff main` — every modified file,
      every changed line. Don't skim.
- [ ] **For every fix in this cycle**, write a one-line mapping to a
      prior UAT report:
      ```
      app/create-watch-party.tsx time-presets → "watch parties not appearing" (v8.4 UAT)
      lib/venueSearchApi.ts bbox     → "venue search 778mi" (v8.4 UAT)
      ```
      If you can't name the prior report, the fix is speculative and
      probably wrong.
- [ ] **For every previously-broken flow**, decide whether your changes
      touched its code path. If yes, add it to the Phase 4 device-walk.
- [ ] **Commit messages match the diff.** No "v8.5: WIP" — if the
      commit shipped to main, the message describes what shipped.

**PASS criterion:** every modified file is traceable to a specific UAT
ticket or product spec. No mystery files.

---

## PHASE 2 — Static gates (5 min, all must be green)

Cheap, automatic, no excuse to skip. Every red here would have stopped
at least one past failed build.

```powershell
# 1.1 TypeScript clean. v8.1 shipped a TS error that masked a runtime crash.
npx tsc --noEmit; if ($LASTEXITCODE -ne 0) { Write-Error "TS FAILED — do not build" }

# 1.2 Audit every silent catch in modified files. v8.4 "RSVP not saving"
#     traced back to `.insert(...)` with no error check.
git diff --name-only main | Select-String '\.(ts|tsx)$' | ForEach-Object {
  $f = $_.ToString()
  $hits = Select-String -Path $f -Pattern 'catch\s*\{\s*\}|catch\s*\(\s*\)\s*\{[^}]*\}' -AllMatches
  if ($hits) { Write-Warning "Silent catch in $f"; $hits | Format-List }
}

# 1.3 Every new .insert / .update / .delete must have an error check.
#     The v8.4 auto-RSVP bug + v8.4 create-group bug were both
#     unchecked inserts that silently failed.
git diff main -- '*.ts' '*.tsx' | Select-String -Pattern '\+.*\.(insert|update|delete)\('

# Then manually verify each new mutation either:
#   - destructures { error } and acts on it
#   - awaits + checks the return for .error
#   - reports via reportError() on catch
#   If not — back to the editor.

# 1.4 No new console.warn in error paths (use reportError).
git diff main -- '*.ts' '*.tsx' | Select-String -Pattern '^\+.*console\.(warn|error)\('
```

**PASS criterion:** TypeScript clean, no unchecked mutations in the
diff, no new silent catches, no new `console.warn` in production code
paths.

---

## PHASE 3 — Backend sanity (10 min, prod DB probes)

The v8.3 ESPN cron auth failure, the v8.4 missing event_id, the
recurring RSVP RLS surprise — none of these were observable in code.
They show up the moment you query the DB.

Run via MCP `execute_sql` against prod (`fwlfiejvxmslkpoojggs`).

### 3.1 — Every RPC called in modified code still exists

```sql
-- Replace the list with the actual RPC names from your diff.
-- Example for v8.5:
SELECT proname, oidvectortypes(proargtypes) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'browse_public_groups',
    'rsvp_to_watch_party',
    'check_rate_limit',
    'toggle_clip_like',
    'has_wc_access',
    'is_chat_room_member'
  );
```
**PASS:** every RPC the client calls is in the result.

### 3.2 — RLS hasn't been inadvertently widened or broken

For each table the diff touches, dump the policies:
```sql
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid)      AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy
WHERE polrelid = 'public.watch_parties'::regclass;     -- and watch_party_rsvps, chat_rooms, etc.
```
**PASS:** policies match the migration that was supposed to set them.
Any "RLS disabled" or wildly permissive policy is a red flag.

### 3.3 — Schema columns referenced in code exist

The v6 cycle shipped a query against `watch_parties.event` (a column
that doesn't exist). Cheap to catch:
```sql
-- Replace with the columns your diff added or queries.
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='watch_parties'
  AND column_name IN ('event_id', 'sport_id', 'venue_city', 'starts_at',
                      'creator_id', 'visibility', 'moderation_status');
```
**PASS:** every column you `.select()` or `.eq()`/`.ilike()` on
appears in the result.

### 3.4 — Recent prod data is healthy

```sql
-- watch_parties created in last 24h: how many have NULL event_id +
-- starts_at in the past? Those won't appear in lists.
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE event_id IS NULL) AS null_event,
  COUNT(*) FILTER (WHERE starts_at < now()) AS past_starts,
  COUNT(*) FILTER (WHERE venue_lat IS NULL) AS null_coords
FROM public.watch_parties
WHERE created_at > now() - INTERVAL '24 hours';

-- watch_party_rsvps in last 24h vs watch_parties — ratio should be
-- close to 1:1 if auto-RSVP works.
SELECT
  (SELECT COUNT(*) FROM watch_parties WHERE created_at > now() - INTERVAL '24 hours') AS parties,
  (SELECT COUNT(*) FROM watch_party_rsvps WHERE created_at > now() - INTERVAL '24 hours') AS rsvps;

-- Fan group owners that are NOT in chat_room_members — the v8.4
-- "must join before posting" bug. Post-pivot the group_type filter is
-- gone; any newly-created chat_room whose owner is missing from
-- members is the same bug pattern.
SELECT cr.id, cr.name, cr.owner_id, cr.group_type
FROM chat_rooms cr
WHERE cr.created_at > now() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM chat_room_members m
    WHERE m.chat_room_id = cr.id AND m.user_id = cr.owner_id
  );
```
**PASS:** ratios make sense, no orphaned owner rows. Any anomaly is
real production data telling you a bug is shipping right now.

### 3.5 — Sentry "Top Issues" last 7 days

Open Sentry dashboard. Top issues by event count. Any P0 that wasn't
addressed in this cycle?

**PASS:** No new high-volume issue without a corresponding fix in the
diff.

---

## PHASE 4 — Expo Go device walk (15 min, MANUAL, the one I keep skipping)

This is the gate that ALL prior failed builds skipped. There is no
substitute. The code can be perfect and the DB can be perfect and the
app can still ship broken because some screen never gets visited.

```powershell
# Start the Expo Go-targeted dev server. Per durable preference:
# never use `expo run:android` — it bypasses Expo Go and the bugs we
# care about live in the JS layer that EAS builds also use.
npx expo start --go --android
```

Sign in as `fansphere.reviewer@gmail.com` (or a fresh sandbox account
if testing purchases). Walk EVERY scenario below. For each, capture
**(a)** what the UI did and **(b)** a DB row that proves the mutation
landed. If both are clean, check the box.

### 4.1 — Sign-in seeds AsyncStorage user_city

- Sign in → wait for tabs → close + reopen app → Discover header should
  show the right city, not "Pick a city".

  ```sql
  -- Verify users.home_city is set for the reviewer
  SELECT home_city FROM users WHERE auth_id = (
    SELECT id FROM auth.users WHERE email = 'fansphere.reviewer@gmail.com'
  );
  ```
- [ ] PASS

### 4.2 — Create watch party with "Tonight 7PM" preset

- Tap Home FAB → Create Watch Party → search a venue ("Brass Tap") →
  pick first result → check distance is <50mi → Next → no game → fill
  Title → select "Tonight 7PM" preset → Create → Alert says "Created!".
- Within 30 seconds, go back to Home → "Watch Parties Near You" should
  show this party at the top.

  ```sql
  -- Verify both the party AND the auto-RSVP row exist
  SELECT wp.id, wp.title, wp.starts_at, wp.event_id, wp.venue_lat,
         (SELECT count(*) FROM watch_party_rsvps r WHERE r.watch_party_id = wp.id) AS rsvps
  FROM watch_parties wp
  WHERE wp.creator_id = (SELECT id FROM auth.users WHERE email = 'fansphere.reviewer@gmail.com')
  ORDER BY wp.created_at DESC LIMIT 1;
  ```
- [ ] PASS: party visible in list + rsvps >= 1.

### 4.3 — Game Day tab surfaces the party (if it has an event_id)

- Game Day tab → find the sport pill that matches the party's sport →
  the party's event (if attached) shows up in "Upcoming today" or
  "Live now" as appropriate.
- If the party had no event attached, Game Day should not crash; the
  party simply won't appear here (it's still on Home + Discover).
- [ ] PASS

### 4.4 — Venue search distance sanity (the v8.4 778mi bug)

- Create Watch Party → search "Chillis" → top 3 results all show
  distance < 50mi.
- [ ] PASS — no Hamilton ON / Moss Point MS / Palm Coast FL in results.

### 4.5 — RSVP from another user's party

- Find a party NOT created by reviewer → tap RSVP → button switches to
  "Going" instantly → no Alert.

  ```sql
  -- Verify the row landed
  SELECT * FROM watch_party_rsvps
  WHERE user_id = (SELECT id FROM auth.users WHERE email='fansphere.reviewer@gmail.com')
    AND created_at > now() - INTERVAL '5 minutes';
  ```
- [ ] PASS: row exists.

### 4.6 — Create a fan group via Discover → Fan Groups → + Create

- Discover tab → Fan Groups section → tap "+ Create" → land on the
  create-group screen (or modal) → fill name → Create → land on detail
  screen → tap "Post a Moment" → pick type → Post.
- [ ] PASS: NO "you may need to join this group" alert. Moment shows
  in feed. Route was `/create-group` (NOT `/create-wc-group`).

  ```sql
  -- Verify owner-as-member row exists immediately after create.
  -- Post-pivot there is no group_type filter — any newly-created
  -- chat_room should have its owner in members.
  SELECT cr.name, cr.group_type, m.role, m.user_id
  FROM chat_rooms cr
  JOIN chat_room_members m ON m.chat_room_id = cr.id
  WHERE cr.created_at > now() - INTERVAL '5 minutes'
    AND cr.owner_id = m.user_id
  ORDER BY cr.created_at DESC LIMIT 5;
  ```

### 4.7 — Join state persists across tab switches

- Join any group from Discover → Fan Groups → Suggested → switch to
  Home tab → switch back → button still shows "Joined", not "Join".
- [ ] PASS

### 4.8 — Profile flows

- Profile → avatar shows (not blank) → tap My Clips → tiles show
  thumbnails or coloured gradients (not pitch-black tiles).
- [ ] PASS

### 4.9 — Clips tab end-to-end

- Clips tab → top clip autoplays → scroll → next clip plays → switch to
  Home → return → previously-playing clip resumes (not frozen).
- [ ] PASS

### 4.10 — Fan Groups discovery not empty

- Discover tab → Fan Groups section → Suggested sub-tab is populated
  (even if just with seeded data). Joined sub-tab shows the groups the
  reviewer belongs to (or a sensible empty-state).
- [ ] PASS

### 4.11 — Sentry check (after walk)

After the device walk, open Sentry → Issues → Last hour. Any new
issues? Investigate before building.

- [ ] PASS

---

## PHASE 5 — Maestro smoke (5 min, automated)

```powershell
# Per memory: Maestro CLI + paths are pinned. Don't reinvent.
& "$env:USERPROFILE\.maestro\bin\maestro.bat" test qa\maestro\00b_tab_crash_regression.yaml
```

The 00b test walks every bottom tab post sign-in and asserts the root
ErrorBoundary never renders. Post-v9.0 it walks the 5-tab layout
(Home, Discover, Game Day, Clips, Profile) — the WC tab it used to
cover was removed with the pivot.

After each UAT cycle, add a new Maestro test for the NEW regressions:
- v8.5 added: `00c_watch_party_create_and_list.yaml`
  (create-party preset → list-shows-party)
- v9.0 added: `04_game_day.yaml`
  (Game Day tab renders with sport pill row + section headers even when
  the day has no live/upcoming games; landed with the v9.0 pivot batch)
- v9.0 also updated: `00b_tab_crash_regression.yaml`
  (5-tab tour: Home / Discover / Game Day / Clips / Profile — was 6)
- v9.0 also updated: `01_signup_onboarding.yaml`
  (post-onboarding tab tour retargeted to the 5-tab set)
- v9.0 removed: `04_world_cup_tab.yaml`, `00d_wc_group_create_post_moment.yaml`
  (Soccer Cup tab + create-wc-group screen were deleted; tests obsolete)

**PASS criterion:** existing scenarios + every new test green.

---

## PHASE 6 — Build config sanity (3 min)

These have all bitten us at least once.

- [ ] **`eas.json`** preview profile has `autoIncrement: true`
      (per memory `feedback_eas_preview_versioning.md`).
- [ ] **`eas.json`** has `"cli": { "appVersionSource": "remote" }`.
- [ ] **No `.easignore` file** in repo root (per memory
      `feedback_eas_windows_archive.md`).
- [ ] **`app.json`** version + iosBuildNumber + androidVersionCode
      bumped from the last shipped value (don't override autoIncrement
      with a stale literal).
- [ ] **`EXPO_PUBLIC_SUPABASE_URL`** points at production
      (`fwlfiejvxmslkpoojggs.supabase.co`), not a dev branch.
- [ ] **Sentry DSN env var present** in build profile so the
      ErrorBoundary that v8.4 added can actually report.
- [ ] **RevenueCat products** — only `premium_monthly` and
      `premium_annual` are referenced by client code. The retired
      `wc_pass_2026` product must NOT appear in any imports, config,
      or offerings check. `grep -R "wc_pass_2026"` returns zero hits.
- [ ] **`git status`** shows no `M` for `package-lock.json` /
      `bun.lockb` / `yarn.lock` you didn't intend to commit.
- [ ] **Last commit is on `main`** and is the commit you intend to
      build from (EAS builds from the current branch HEAD by default;
      a stray dev branch is the v8.4-mistaken-iOS-build pattern).

---

## PHASE 7 — GO / NO-GO

Binary decision. If any single box above is unchecked or red, the answer
is NO-GO.

```
Phase 0  v9.0 Pivot Sanity   [ ] PASS  [ ] FAIL
Phase 1  Triage              [ ] PASS  [ ] FAIL
Phase 2  Static gates        [ ] PASS  [ ] FAIL
Phase 3  Backend sanity      [ ] PASS  [ ] FAIL
Phase 4  Device walk         [ ] PASS  [ ] FAIL
Phase 5  Maestro smoke       [ ] PASS  [ ] FAIL
Phase 6  Build config        [ ] PASS  [ ] FAIL

Decision: [ ] GO   [ ] NO-GO   Date / time: _______________
```

Only when this is **all GO** do you spend EAS credits.

---

## PHASE 8 — Post-build artifact verification (5 min)

After the EAS build finishes, BEFORE you hand it to UAT:

- [ ] AAB downloaded; SHA-256 captured. Different from previous build.
- [ ] APK extracted via bundletool. File size sane (~70-100 MB).
- [ ] On Windows: `touch` the APK file mtime to "now" before copy to
      OneDrive — bundletool sets mtime to 1981 and OneDrive treats it as
      already-synced (v8.4 mistake).
- [ ] APK installed on a real Android device (yours, NOT just the
      reviewer's). Open it. Walk the Phase 0 pivot-sanity + Phase 4
      device-walk scripts ONE more time on the actual artifact, not
      on Expo Go. **The build can disagree with Expo Go** — JS engine
      version, Hermes vs JSC, native modules. Catch it before the
      tester does.
- [ ] iOS .ipa landed in TestFlight (if applicable) and shows up in
      the tester's TestFlight client. Don't rely on "TestFlight email"
      — it lags by 15 minutes.

Only after this is the build "ready for UAT."

---

## Maintaining this document

Every UAT cycle, do this in retro:

1. For each UAT bug we shipped, which phase SHOULD have caught it?
2. Was the check in that phase actually run? If not, why was it
   skipped? (Time pressure isn't a valid answer — strengthen the gate.)
3. If the check was run but didn't catch it, the check was too vague.
   Make it specific.

The goal is convergence: every UAT bug we ship adds a new specific
check, and the count of unique check types climbs toward steady state.
If the checklist isn't getting longer over time, regressions ARE
slipping through it.
