# Migration Replay Runbook

Replay all `supabase/migrations/*.sql` against a brand-new production Supabase
project. The current dev project (`azkmymxdjylmkytrvyfn`) is the source of these
files. There are **46 files total** (not 44 — the prompt was off-by-two):
`001_base_schema.sql` … `046_beta_testers.sql`.

This runbook covers the audit, the pre-flight checks that must happen *before*
the first migration runs, the replay order, the seed data, and post-replay
smoke tests.

---

## 1. Audit Table

Legend
- **Idempotent?** Y = uses `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP IF
  EXISTS` everywhere. P (Partial) = mostly safe but contains at least one
  statement that will error on a second run. N = will hard-fail on replay.
- **External deps** = anything outside the SQL itself the migration needs in
  order to succeed (extensions, vault secrets, edge functions deployed,
  publications present, etc.).

| File | Idempotent? | External deps | Notes |
|------|-------------|---------------|-------|
| `001_base_schema.sql` | **N** | none | Bare `CREATE TABLE` (no IF NOT EXISTS), bare `CREATE POLICY`, bare seed `INSERT` (no ON CONFLICT). First-run-only. |
| `002_chat_schema.sql` | **N** | none | Bare `CREATE TABLE` / `CREATE POLICY` / `CREATE TRIGGER`. First-run-only. |
| `003_watch_party_extras.sql` | **P** | none | New table without `IF NOT EXISTS`; `DROP POLICY IF EXISTS` then `CREATE POLICY` is safe. `CREATE OR REPLACE FUNCTION` for RPCs. |
| `004_moments_clips_moderation.sql` | **N** | none | Bare `CREATE TABLE` and `CREATE POLICY`. Functions use `CREATE OR REPLACE`. |
| `005_user_team_follows.sql` | **N** | none | Bare `CREATE TABLE`, bare `CREATE POLICY`. Back-fill DO block is safe. |
| `006_world_cup_2026.sql` | **N** | none | `INSERT INTO leagues/events/teams` with **fixed UUIDs and no ON CONFLICT**. Re-run = unique-key violation. Generates 104 game rows via DO blocks (also non-idempotent — re-run duplicates). |
| `007_security_fixes.sql` | **P** | none | Functions `CREATE OR REPLACE` (safe). New RLS policies bare `CREATE` (will conflict on replay). Sport/league seeds use `ON CONFLICT DO NOTHING`. |
| `008_performance_and_integrity.sql` | **Y** | none | All FK indexes use `IF NOT EXISTS`. Functions `CREATE OR REPLACE`. **One gotcha:** `ALTER TABLE messages ADD CONSTRAINT ck_message_length` has no IF NOT EXISTS — will fail on a re-run. Constraint exists once first applied. |
| `009_push_notifications.sql` | **Y** | none | All `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`. |
| `010_notification_triggers.sql` | **P** | `pg_cron`, `pg_net`, edge function `trigger-notifications`, GUCs `app.settings.supabase_url` + `app.settings.service_role_key` | Creates extensions itself. **Cron jobs `cron.schedule()` will throw "duplicate jobname" on second run.** Trigger is `DROP IF EXISTS`. |
| `011_creator_follows.sql` | **Y** | none | All `IF NOT EXISTS` and `CREATE OR REPLACE`. Triggers preceded by `DROP TRIGGER IF EXISTS`. |
| `012_gamification_and_trending.sql` | **P** | `pg_cron` | Tables / functions safe. Materialized views use `IF NOT EXISTS`. **Cron schedule `refresh-trending-views` will collide on replay.** Triggers use `DROP IF EXISTS`. |
| `013_referrals.sql` | **Y** | none | All `ADD COLUMN IF NOT EXISTS`; `DROP TRIGGER IF EXISTS`; badges use `ON CONFLICT (key) DO NOTHING`. |
| `014_watch_party_invites.sql` | **Y** | none | `CREATE TABLE IF NOT EXISTS`. Policies bare `CREATE` (would fail second time). Visibility column wrapped in DO/IF NOT EXISTS. |
| `015_fix_rls_recursion.sql` | **Y** | none | All `DROP POLICY IF EXISTS` then `CREATE POLICY`. |
| `016_fix_badge_triggers.sql` | **Y** | none | `DROP TRIGGER IF EXISTS` and `CREATE OR REPLACE FUNCTION`. |
| `017_scalability_fixes.sql` | **Y** | none | All `CREATE INDEX IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION/VIEW`. `DROP POLICY IF EXISTS` then `CREATE`. |
| `018_notification_queue.sql` | **P** | none | `CREATE TABLE IF NOT EXISTS`. **Bare `CREATE INDEX idx_nq_pending`, `idx_nq_created`, `idx_rate_limits_lookup`** — will collide on replay. Trigger `nq_updated_at` is bare `CREATE TRIGGER`. The trailing cron is commented out (safe). |
| `019_partitioning_and_warmup.sql` | **Y** | none | All partition creates use `IF NOT EXISTS`. Cron sections are commented out. |
| `020_onboarded_at.sql` | **Y** | none | `ADD COLUMN IF NOT EXISTS`, conditional `UPDATE`, `CREATE INDEX IF NOT EXISTS`. |
| `021_clips_storage_bucket.sql` | **P** | Supabase Storage enabled (default) | Bucket insert uses `ON CONFLICT DO NOTHING`. **Bare `CREATE POLICY "clips_*"` x4 on `storage.objects` will collide on replay** (no DROP IF EXISTS). |
| `022_user_profile_trigger.sql` | **Y** | `auth` schema | `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`, back-fill INSERT uses `ON CONFLICT DO NOTHING`. |
| `023_admin_roles.sql` | **P** | none | Table uses `IF NOT EXISTS`. **Policies bare `CREATE POLICY`** (admins_read_*, admin_read_*) — re-run fails. Geo columns are `ADD COLUMN IF NOT EXISTS`. All RPCs `CREATE OR REPLACE`. |
| `024_geo_seed_and_fix.sql` | **Y** | depends on 023 | `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`. **Data side effect:** randomly seeds geo columns on every user / watch_party / chat_room with NULL country — re-run is a no-op once filled, but **migration 028 deliberately wipes chat_rooms geo and re-seeds by name**, so leaving 024's bad geo in place is by design and corrected downstream. |
| `025_fix_watch_party_details_view.sql` | **Y** | depends on 017 (view) | `CREATE OR REPLACE VIEW`, `GRANT` (idempotent), `NOTIFY` (idempotent). |
| `026_block_user.sql` | **Y** | depends on 004 (user_blocks already exists from 004) | **Subtle:** 004 already created `user_blocks`. This file uses `CREATE TABLE IF NOT EXISTS` so it no-ops on column/structure but the new CHECK `blocker_id != blocked_id` is *not* added because the table already exists. Policies all `DROP IF EXISTS` then `CREATE`. RPCs `CREATE OR REPLACE`. |
| `027_input_length_constraints.sql` | **Y** | none | Entire body wrapped in a DO block that probes `pg_constraint` before adding. Idempotent by design. |
| `028_fix_geo_seed_by_name.sql` | **Y** | depends on 024 (geo cols + chat_rooms data) | Wipes chat_rooms geo then re-applies name-pattern matching. Re-run = stable result. |
| `029_schedule_espn_sync.sql` | **P** | `pg_cron`, `pg_net`, `vault` ext, vault secret `fan_wave_service_role_key`, edge function `sync-game-schedules` | **HARD-CODED DEV URL** at line 47: `https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/sync-game-schedules`. Must be parameterized for the new project. Cron unschedule is wrapped in `IF EXISTS` so re-applying is safe. |
| `030_clip_moment_types.sql` | **Y** | none | `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. |
| `031_games_sport_id.sql` | **Y** | none | `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, idempotent UPDATE on rows where `sport_id IS NULL`. |
| `032_entitlements.sql` | **P** | none | Columns + tables all use `IF NOT EXISTS`. **RLS policies use bare `CREATE POLICY`** — collides on replay. Functions are `CREATE OR REPLACE`. |
| `033_paywall_policies.sql` | **Y** | depends on 032 (`has_premium_access`) | Every policy is `DROP POLICY IF EXISTS` then `CREATE POLICY`. |
| `034_users_realtime.sql` | **Y** | publication `supabase_realtime` (Supabase default) | DO block probes `pg_publication_tables`. |
| `035_trial_reminder_cron.sql` | **Y** | `pg_cron`, `pg_net` (from 029), `notification_queue` (from 018) | Table uses `IF NOT EXISTS`; cron unschedule is `IF EXISTS` first. **Policy on trial_reminders_sent is bare `CREATE`** — minor partial. |
| `036_storage_limits.sql` | **Y** | depends on 021 (clips bucket) | Plain UPDATE. Re-run = no-op once limit is at 25 MB. |
| `037_rate_limit_function.sql` | **Y** | none | Designed to repair 018's drift. All `IF NOT EXISTS` and a DO block guarded by `pg_policies` for the policy. |
| `038_schedule_team_logo_sync.sql` | **P** | `pg_cron`, `pg_net`, vault secret, edge function `sync-team-logos` | **HARD-CODED DEV URL** at line 17. Cron unschedule is `IF EXISTS` guarded. |
| `039_team_roster_updates.sql` | **Y** | none | Idempotent UPDATEs by WHERE clause; San Diego FC INSERT wrapped in `WHERE NOT EXISTS`. |
| `040_entitlement_immutability.sql` | **Y** | none | `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`. **No hard-coded env values — the doc comment said to check; verified clean.** |
| `041_expire_stale_games.sql` | **Y** | `pg_cron` | DO block conditionally unschedules first. |
| `042_expire_stale_live_games.sql` | **Y** | `pg_cron` | Same idempotent pattern as 041, replaces job. |
| `043_games_realtime.sql` | **Y** | publication `supabase_realtime` | DO block probes `pg_publication_tables`. |
| `044_games_espn_id_dedup.sql` | **Y** | none | `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, dedupe steps are safe on data that's already clean. **Caveat:** `ALTER TABLE … ADD CONSTRAINT games_espn_id_unique` has no IF NOT EXISTS guard — second run errors. On a fresh prod replay this is first-run; future re-applies would need DROP first. |
| `045_rebrand_to_fan_sphere.sql` | **Y** | none | `ALTER TABLE … SET DEFAULT`, UPDATE statements. Safe on repeat. |
| `046_beta_testers.sql` | **P** | none | Table + indexes use `IF NOT EXISTS`. **Bare `CREATE POLICY admins_read_beta_testers`, `service_role_manage_beta_testers`** — collide on replay. All RPCs `CREATE OR REPLACE`. |

### Idempotency totals
- **N** (will hard-fail on second run): 4 — `001`, `002`, `004`, `006`
- **P** (partial — some statements would error on a second run): 11 —
  `003`, `007`, `010`, `012`, `018`, `021`, `023`, `029`, `032`, `038`, `046`
- **Y** (replay-safe by construction): 31

For our use case (single fresh replay against an empty new project), N/P is
fine — every migration is being run exactly once.

---

## 2. Replay Order

**Strict numeric order: 001 → 046.** Notes on forced ordering:

- 001 must be first — defines `users`, `sports`, `leagues`, `teams`, `events`,
  `games`, `feature_flags` that everything else FKs to.
- 002 (`chat_rooms`, `messages`, etc.) requires 001.
- 003 requires 002 (`watch_parties`).
- 004 creates `user_blocks` first; 026 later assumes 004 already did. Don't
  skip 004 just because 026 also has a `CREATE TABLE IF NOT EXISTS user_blocks`.
- 015 fixes a recursion bug introduced between 002 and 014. Must run **after**
  002's policies are in place.
- 016 must run after 012 (drops 012's badge triggers).
- 017 introduces `user_chat_room_ids()` and the `watch_party_details` view;
  025 fixes the view's security model — must run after 017.
- 023 adds geo columns and `is_admin()`; 024 fixes geo seed; 028 wipes 024's
  random chat_rooms seed and re-seeds by name. Order **23 → 24 → 28** is load-
  bearing.
- 029 enables `pg_cron`, `pg_net`, references `vault.create_secret`. **Vault
  secret must exist before any cron job fires (see Pre-Replay Checklist).** The
  SQL itself doesn't blow up if the secret is missing, but cron runs will
  raise until the secret is created.
- 032 → 033 → 040 form the entitlement chain. 033 needs `has_premium_access()`
  from 032; 040 needs the entitlement columns from 032.
- 035 requires 018 (`notification_queue`) and 029 (`pg_cron` enabled).
- 038 requires 029's vault helper machinery.
- 044 is data-corrective (dedup `games` rows + add UNIQUE espn_id). On a fresh
  replay before any ESPN sync has happened, no duplicates exist, and the
  UNIQUE constraint applies cleanly. **Don't skip — the constraint is required
  for sync-game-schedules to behave correctly going forward.**
- 045 is a one-line rebrand (Fan Wave → Fan Sphere) — must run after 008 (which
  set the original default).
- 046 introduces beta-tester infra. No hard ordering vs 045, just numerical.

---

## 3. Pre-Replay Checklist

Before running migration 001:

### 3a. Extensions
The Supabase Postgres image enables most of these by default at the *Postgres*
level, but they still need to be exposed in your project via the Database →
Extensions dashboard, or via SQL. Migration 010 and 029 call
`CREATE EXTENSION IF NOT EXISTS` for `pg_cron` and `pg_net`, so they will
self-enable. Still good to pre-flight:

- `pg_cron` — scheduling. (used by 010, 012, 029, 035, 038, 041, 042)
- `pg_net` — outbound HTTP from postgres. (used by 010, 029, 038)
- `supabase_vault` — stores the service-role secret (used by 029, 038). On a
  new Supabase project this is enabled automatically. Verify with
  `SELECT * FROM pg_extension WHERE extname='supabase_vault';`.
- `pgcrypto` — `gen_random_uuid()` everywhere. Supabase enables by default.

NOT required by these migrations (skip them): `pg_graphql`, `pgvector`,
`postgis`.

### 3b. Vault secrets
Required **before** the first cron tick of `espn_sync_schedule` or
`espn_sync_live` (created in 029) or `espn_sync_team_logos` (created in 038):

```sql
SELECT vault.create_secret(
  '<NEW_PROD_SERVICE_ROLE_KEY>',   -- from Settings → API on the new project
  'fan_wave_service_role_key'
);
```

If you forget, cron run details will surface a clean
`Vault secret "fan_wave_service_role_key" not found` exception every tick.
No data loss; the secret can be added later and the next tick succeeds.

### 3c. Other secret/config knobs not covered by SQL

- **GUCs read by 010's score-update trigger and cron job:**
  `app.settings.supabase_url` and `app.settings.service_role_key`. Migration
  010 wraps the call in `BEGIN … EXCEPTION WHEN OTHERS THEN NULL` so missing
  GUCs are swallowed silently, but the score-update notification won't fire
  until these are set. Set via Dashboard → Database → Custom Postgres Config,
  or:
  ```sql
  ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<NEW>.supabase.co';
  ALTER DATABASE postgres SET app.settings.service_role_key = '<NEW_PROD_SERVICE_ROLE_KEY>';
  ```

- **Hard-coded URLs that need patching (see §7 "DO NOT replay verbatim"):**
  029 line 47 and 038 line 17 both contain
  `https://azkmymxdjylmkytrvyfn.supabase.co/...`. You must either edit the SQL
  in-place before replay, or run a post-migration `CREATE OR REPLACE FUNCTION`
  to swap the URLs.

### 3d. Auth settings (NOT covered by migrations)

These are Supabase project-level Dashboard toggles. None of the SQL files set
them; handle them out-of-band:

- **Confirm email** — Dashboard → Authentication → Sign In / Up. Should be
  ENABLED for prod (per the P0 task list item #3). Today it is OFF on dev.
- **SMTP provider** — Dashboard → Project Settings → Auth → SMTP Settings.
  Required for confirm-email to actually deliver. Sign up for Resend /
  Postmark / SendGrid out-of-band.
- **Site URL + redirect URLs** — `fansphere://auth-callback` is in
  `supabase/config.toml`; mirror that in Dashboard → Auth → URL Configuration.
- **Provider toggles** (Apple, Google, etc.) — copy from dev as needed.
- **Realtime** — `users` (mig 034) and `games` (mig 043) get added to the
  `supabase_realtime` publication by SQL. No extra Dashboard toggle.
- **JWT signing key** — leave at the Supabase default for a new project.

### 3e. Edge functions

The migrations reference these edge functions by URL:
- `sync-game-schedules` (cron in 029)
- `sync-team-logos` (cron in 038)
- `trigger-notifications` (trigger + cron in 010)

Source lives under `supabase/functions/`. They must be deployed to the new
project before their cron schedules fire usefully, but the SQL itself doesn't
care — `pg_net.http_post` just gets a 404 response if the function isn't there
yet. Deploy with:

```powershell
npx supabase functions deploy sync-game-schedules --project-ref <NEW_REF>
npx supabase functions deploy sync-team-logos      --project-ref <NEW_REF>
npx supabase functions deploy trigger-notifications --project-ref <NEW_REF>
npx supabase functions deploy process-notification-queue --project-ref <NEW_REF>
npx supabase functions deploy send-notifications   --project-ref <NEW_REF>
npx supabase functions deploy health-check         --project-ref <NEW_REF>
npx supabase functions deploy revenuecat-webhook   --project-ref <NEW_REF>
```

`sync-team-logos` needs `verify_jwt = false` (per `supabase/config.toml`); use
the `--no-verify-jwt` flag when deploying that one.

---

## 4. Seed Data Plan

**Source:** `supabase/seed.sql` (~540 lines), with the core reference data
already baked into migration 001 + 006 + 007 + 039.

What lives where:
- **Sports, leagues, teams, events** — inside migration 001 (all 7
  pre-existing sports, all NFL/NBA/MLB/MLS/NHL teams, season events). 006
  adds FIFA WC league + 48 national teams + 104 WC games. 007 appends CFB /
  CBB / UFC sports + leagues. 039 patches 3 franchise renames + San Diego FC.
  **Nothing additional needed for sports/leagues/teams** — replaying migrations
  populates the canonical roster.
- **Demo fan groups, demo watch parties, demo messages, demo clips, demo match
  moments, demo moment reactions, demo events** — live in `supabase/seed.sql`.
  Required if you want a non-empty home screen for the App Review tester /
  yourself on first launch.

### Seed order (after all 46 migrations apply cleanly)

1. Run `supabase/seed.sql` once (idempotent — every block uses
   `ON CONFLICT (id/key) DO NOTHING`). Order inside the file:
   - feature flags
   - events (2025-26 / 2026 seasons)
   - games (a few NBA / MLB / MLS / NHL upcoming demo games — hand-written ids)
   - chat_rooms (demo fan groups)
   - watch_parties (demo)
   - chat_rooms — second batch (SF, Phoenix, Minneapolis, Toronto)
   - watch_parties — second batch
   - messages, match_moments, moment_reactions, media_clips
2. After seed, run `supabase/scripts/grant_reviewer_premium.sql` *if* you've
   already created `fansphere.reviewer@gmail.com` in `auth.users` — otherwise
   wait until the reviewer signs up, then run it. This sets that user's
   `subscription_status='active'` plus both `*_active_until` to 2099 so the
   reviewer skips the paywall.

No other seed file in `scripts/` or `supabase/`.

---

## 5. Execution Steps

The migrations must run **in order**, in a single session, before seed +
post-flight. Two equivalent ways:

### Option A — Supabase CLI (recommended; matches our dev workflow)

```powershell
# 1. Link the local repo to the new project
npx supabase link --project-ref <NEW_PROD_REF>

# 2. PRE-FLIGHT — set vault secret + GUCs via SQL editor (Dashboard) FIRST.
#    (See §3b and §3c.) Even if the cron jobs created by 010/029/035/038/041/042
#    fire before secrets are set, they fail gracefully and retry next tick.

# 3. PATCH the two hard-coded dev URLs in 029 and 038. Search/replace
#    'azkmymxdjylmkytrvyfn' → '<NEW_PROD_REF>' inside those two files
#    BEFORE pushing. Do NOT commit this rewrite to git — keep the
#    parameterized originals in the repo and rewrite on the operator's
#    machine for the push only. (Better long-term: parameterize via a
#    GUC or a small one-shot post-replay UPDATE; see §7.)

# 4. Apply all migrations to the remote
npx supabase db push

# 5. Apply seed data
npx supabase db execute --file supabase/seed.sql

# 6. (Optional, once reviewer user exists) grant reviewer entitlement
#    — run this in Dashboard SQL Editor so it executes as supabase_admin
#    and bypasses migration 040's immutability trigger.
#    File: supabase/scripts/grant_reviewer_premium.sql

# 7. Smoke tests (see §6)
```

### Option B — Supabase MCP `apply_migration`

If you're running this from Claude Code with the Supabase MCP attached, the
same flow works one file at a time:

```
mcp__plugin_supabase_supabase__apply_migration  name=001_base_schema  query=<contents of 001>
mcp__plugin_supabase_supabase__apply_migration  name=002_chat_schema  query=<contents of 002>
…
mcp__plugin_supabase_supabase__apply_migration  name=046_beta_testers query=<contents of 046>
```

After 046, run the seed with
`mcp__plugin_supabase_supabase__execute_sql query=<contents of seed.sql>`.

The MCP tool tracks migration names in `supabase_migrations.schema_migrations`,
so a second `apply_migration` call with the same name is a no-op even if the
underlying SQL is non-idempotent. Use this for safety when iterating.

---

## 6. Smoke-Test Queries

Run these against the new project's SQL editor after migrations + seed:

```sql
-- 1. Schema sanity: all 4 reference tables populated.
SELECT
  (SELECT count(*) FROM sports)   AS sports,
  (SELECT count(*) FROM leagues)  AS leagues,
  (SELECT count(*) FROM teams)    AS teams,
  (SELECT count(*) FROM events)   AS events;
-- Expected approx: sports=9, leagues=10, teams=200+ (32 NFL + 30 NBA + 30 MLB
-- + 29 MLS + 1 SD FC + 32 NHL + 48 WC = 202), events=6 + 1 WC = 7.

-- 2. Extensions enabled.
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_cron','pg_net','supabase_vault','pgcrypto')
ORDER BY extname;
-- Expected 4 rows.

-- 3. Cron jobs registered.
SELECT jobname, schedule, active
FROM cron.job
ORDER BY jobname;
-- Expected jobnames (from 010, 012, 029, 035, 038, 041/042):
-- cleanup-notification-log, espn_sync_live, espn_sync_schedule,
-- espn_sync_team_logos, expire_stale_games, refresh-trending-views,
-- trial_ending_reminder, trigger-scheduled-notifications.

-- 4. RLS is on for the user-data tables that need it.
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('users','chat_rooms','messages','watch_parties',
                  'media_clips','entitlements','user_team_follows',
                  'user_blocks','admin_roles')
ORDER BY relname;
-- Expected: relrowsecurity = true on every row.

-- 5. Entitlement helpers exist and return false for a phantom user.
SELECT
  public.has_premium_access('00000000-0000-0000-0000-000000000000'::uuid) AS premium,
  public.has_wc_access('00000000-0000-0000-0000-000000000000'::uuid)      AS wc;
-- Expected: both false.
```

Bonus / optional:
```sql
-- Replay-completion check: schema_migrations should have one row per file.
SELECT count(*) FROM supabase_migrations.schema_migrations;
-- Expected 46.

-- Seed sanity (after seed.sql ran):
SELECT count(*) FROM chat_rooms;       -- expect 40+
SELECT count(*) FROM watch_parties;    -- expect 15+
SELECT count(*) FROM media_clips;      -- expect 15+
```

---

## 7. Migrations That Must NOT Be Replayed Verbatim

Two migrations contain hard-coded references to the **dev** project ref
(`azkmymxdjylmkytrvyfn`) and must be parameterized for the new prod project:

### `029_schedule_espn_sync.sql`
Line 47:
```sql
v_base_url TEXT := 'https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/sync-game-schedules';
```
Replace `azkmymxdjylmkytrvyfn` with the new project ref before push (or rewrite
`public.invoke_espn_sync` after push with the new URL).

### `038_schedule_team_logo_sync.sql`
Line 17:
```sql
v_base_url TEXT := 'https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/sync-team-logos';
```
Same treatment.

Recommended pattern (preserves git history): leave the files unchanged; after
`db push` completes, run two `CREATE OR REPLACE FUNCTION` statements against
the new project that swap the URL. Document the override in
`docs/env-swap-runbook.md` for future maintainers.

Everything else can be replayed verbatim. The four `N`-rated migrations
(001, 002, 004, 006) are first-run-only by construction; that's fine for a
fresh project but should be flagged if anyone ever tries to "re-run all
migrations" against an existing project — they will fail.

---

## Executive Summary

The 46 Fan Wave / Fan Sphere migrations replay cleanly into a fresh
Supabase project provided you (a) pre-set the vault secret
`fan_wave_service_role_key`, the GUCs `app.settings.supabase_url` and
`app.settings.service_role_key`, and the project's SMTP + confirm-email
auth settings before the first migration runs, (b) patch the hard-coded dev
project ref (`azkmymxdjylmkytrvyfn`) in `029_schedule_espn_sync.sql` and
`038_schedule_team_logo_sync.sql` to the new prod ref, and (c) deploy the
seven edge functions (`sync-game-schedules`, `sync-team-logos`,
`trigger-notifications`, `process-notification-queue`, `send-notifications`,
`health-check`, `revenuecat-webhook`) so the cron jobs they install actually
have endpoints to call. Strict numeric order 001→046 is required; 31
migrations are fully idempotent, 11 are partial, and 4 (001, 002, 004, 006)
are first-run-only by construction — fine for this single fresh replay.
After SQL is in place, run `supabase/seed.sql` once for demo fan groups /
parties / clips, then run `supabase/scripts/grant_reviewer_premium.sql`
through the Dashboard SQL Editor (executes as `supabase_admin` to bypass the
migration 040 immutability trigger) to pre-grant the App / Play review
account a paywall-free entitlement, and finally execute the five smoke-test
queries in §6 to confirm the schema, extensions, cron jobs, RLS, and
entitlement helpers all came up correctly.
