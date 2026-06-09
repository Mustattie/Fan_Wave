-- cleanup_test_users.sql
--
-- Purpose: remove test / Maestro / QA user accounts from the DEV/QA
-- Supabase project (`azkmymxdjylmkytrvyfn`). The dev project is currently
-- shared with the Play Store-live build (1.0.0 build 3), so any leftover
-- test accounts pollute counters (follower_count, member_count,
-- referral_count) and can author content that shows up to real users.
--
-- Run this against the DEV/QA Supabase project via the SQL Editor (so it
-- executes as supabase_admin and bypasses RLS). It is NOT meant for the
-- new prod project — that one starts empty.
--
-- Defaults to DRY RUN — no rows are deleted until the user uncomments the
-- DELETE block at the bottom. Counts are logged before/after for audit.
--
-- Criteria for "test user" (boolean OR):
--   1. auth.users.email matches a known test pattern: substring 'test',
--      'maestro', 'qa', 'dev', '+test', or @example.com / @mailinator.com.
--   2. auth.users.email is one of the explicit known test addresses
--      enumerated below (extend this list as new ones are created).
--   3. public.users.subscription_status IN ('trial','active') BUT the user
--      has zero rows in `entitlements` — i.e. status was hand-granted
--      (via grant_reviewer_premium.sql or a Studio edit) but the
--      RevenueCat webhook never confirmed a purchase. This catches dev
--      accounts where premium was manually flipped on for QA.
--      (There is no rc_subscriber_id column on `users`; the codebase uses
--      `entitlements.user_id` as the RC linkage — see migration 032.)
--
-- EXCLUDED — never deleted by this script:
--   - The reviewer account (fansphere.reviewer@gmail.com). Its
--     hand-granted entitlement (from grant_reviewer_premium.sql) is
--     intentional and Apple/Google reviewers need it.
--   - Any account that does NOT match a test pattern AND has matching
--     entitlements rows (i.e. a real paying user).
--
-- ────────────────────────────────────────────────────────────────────────
-- FOREIGN KEY MAP — read before changing the delete order
-- ────────────────────────────────────────────────────────────────────────
-- public.users has NO FK to auth.users (auth_id is UUID UNIQUE, no
-- REFERENCES clause — see migration 001). So deleting auth.users does
-- NOT cascade to public.users. We must delete both.
--
-- Most user-referencing tables in this schema store `user_id` as a raw
-- UUID with NO REFERENCES clause (legacy from migrations 002–019), so
-- there is no built-in cascade. The only two tables that DO have a real
-- FK on users(id) with ON DELETE CASCADE are:
--   - admin_roles            (migration 023 — user_id, granted_by)
--   - beta_testers           (migration 046 — user_id)
--
-- All other rows authored by a deleted user must be removed BEFORE the
-- users row, in this dependency order:
--
--   moment_reactions   (FK → match_moments.id CASCADE, but its own user_id is bare)
--   clip_likes         (FK → media_clips.id CASCADE, but its own user_id is bare)
--   clip_comments      (FK → media_clips.id CASCADE, but its own user_id is bare)
--   media_clips        (bare user_id)
--   match_moments      (bare user_id)
--   watch_party_invites (bare invited_by)
--   watch_party_rsvps  (bare user_id)
--   watch_parties      (bare creator_id)        — content the user CREATED
--   messages           (bare user_id)
--   chat_room_members  (bare user_id)
--   chat_rooms         (bare owner_id)          — content the user OWNS
--   banned_members     (bare user_id, banned_by)
--   user_blocks        (bare blocker_id, blocked_id)
--   content_flags      (bare flagger_id)
--   moderation_log     (bare performed_by)
--   user_team_follows  (bare user_id)
--   user_follows       (bare follower_id, following_id)
--   user_badges        (bare user_id)
--   user_streaks       (bare user_id)
--   analytics_events   (bare user_id)
--   notification_log   (bare user_id where present)
--   notification_queue (push_token, NOT user_id — skipped)
--   rate_limits        (bare user_id)
--   entitlements       (bare user_id)
--   purchase_events    (bare user_id)
--   trial_reminders_sent (bare user_id)
--   public.users       (last)
--   auth.users         (last — separate statement, requires service_role)
--
-- The script wraps everything in a single transaction so any FK
-- violation rolls the whole thing back.

-- ─── 0. Settings ───────────────────────────────────────────────────────
\set reviewer_email 'fansphere.reviewer@gmail.com'

BEGIN;

-- ─── 1. Pre-cleanup audit counts ───────────────────────────────────────
SELECT 'pre_cleanup_auth_users'   AS metric, COUNT(*) AS value FROM auth.users;
SELECT 'pre_cleanup_public_users' AS metric, COUNT(*) AS value FROM public.users;

-- Materialise the set of doomed auth_ids exactly once so every following
-- block sees the same set even as rows are deleted.
CREATE TEMP TABLE _doomed_auth_ids ON COMMIT DROP AS
SELECT au.id AS auth_id, au.email
FROM auth.users au
WHERE
    -- Reason A: email matches a test pattern.
    (
        au.email ILIKE '%test%'
        OR au.email ILIKE '%maestro%'
        OR au.email ILIKE '%qa%'
        OR au.email ILIKE '%dev%'
        OR au.email ILIKE '%+test%'
        OR au.email ILIKE '%@example.com'
        OR au.email ILIKE '%@mailinator.com'
    )
    -- Reason B: explicit known test emails (extend as new ones appear).
    OR au.email IN (
        'maestro.runner@gmail.com',
        'fanwave.test1@gmail.com',
        'fanwave.test2@gmail.com',
        'fanwave.qa@gmail.com'
    )
    -- Reason C: subscription_status hand-granted (trial/active) but no
    -- corresponding entitlements row from the RC webhook. This catches
    -- accounts where premium was manually flipped on for QA.
    OR au.id IN (
        SELECT u.auth_id
        FROM public.users u
        WHERE u.subscription_status IN ('trial', 'active')
          AND NOT EXISTS (
              SELECT 1 FROM public.entitlements e
              WHERE e.user_id = u.auth_id
          )
    )
-- Hard exclusion: NEVER sweep the reviewer account.
AND au.email <> 'fansphere.reviewer@gmail.com';

-- ─── 2. DRY RUN PREVIEW — which accounts and why ───────────────────────
SELECT
    dai.auth_id,
    dai.email,
    u.display_name,
    u.subscription_status,
    u.premium_active_until,
    (SELECT COUNT(*) FROM public.entitlements e WHERE e.user_id = dai.auth_id) AS entitlement_count,
    CASE
        WHEN dai.email ILIKE '%test%'
          OR dai.email ILIKE '%maestro%'
          OR dai.email ILIKE '%qa%'
          OR dai.email ILIKE '%dev%'
          OR dai.email ILIKE '%+test%'
          OR dai.email ILIKE '%@example.com'
          OR dai.email ILIKE '%@mailinator.com'
            THEN 'test_email_pattern'
        WHEN dai.email IN (
            'maestro.runner@gmail.com',
            'fanwave.test1@gmail.com',
            'fanwave.test2@gmail.com',
            'fanwave.qa@gmail.com'
        )
            THEN 'explicit_known_test'
        WHEN u.subscription_status IN ('trial', 'active')
         AND NOT EXISTS (SELECT 1 FROM public.entitlements e WHERE e.user_id = dai.auth_id)
            THEN 'hand_granted_no_rc_entry'
        ELSE 'unknown'
    END AS deletion_reason
FROM _doomed_auth_ids dai
LEFT JOIN public.users u ON u.auth_id = dai.auth_id
ORDER BY dai.email;

SELECT 'dry_run_would_delete_users' AS metric, COUNT(*) AS value FROM _doomed_auth_ids;

-- Per-table row counts that would be removed.
SELECT 'media_clips_rows'        AS metric, COUNT(*) AS value FROM public.media_clips        WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'match_moments_rows'      AS metric, COUNT(*) AS value FROM public.match_moments      WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'messages_rows'           AS metric, COUNT(*) AS value FROM public.messages           WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'chat_room_members_rows'  AS metric, COUNT(*) AS value FROM public.chat_room_members  WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'chat_rooms_owned_rows'   AS metric, COUNT(*) AS value FROM public.chat_rooms         WHERE owner_id    IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'watch_parties_owned_rows' AS metric, COUNT(*) AS value FROM public.watch_parties     WHERE creator_id  IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'watch_party_rsvps_rows'  AS metric, COUNT(*) AS value FROM public.watch_party_rsvps  WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'user_team_follows_rows'  AS metric, COUNT(*) AS value FROM public.user_team_follows  WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
SELECT 'entitlements_rows'       AS metric, COUNT(*) AS value FROM public.entitlements       WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);

-- ─── 3. End of DRY RUN ─────────────────────────────────────────────────
-- Stop here on first execution. Review the preview rows above. If they
-- look right, re-run the script with section 4 uncommented.

ROLLBACK;

-- =========================================================================
-- 4. DELETE BLOCK — UNCOMMENT WHEN READY TO ACTUALLY DELETE
-- =========================================================================
-- Pre-flight checklist:
--   a. Take a backup snapshot of the project (Supabase dashboard →
--      Database → Backups → "Create snapshot"). Do NOT skip this.
--   b. Confirm cleanup_test_clips.sql has been run (or is also queued in
--      this session) — orphaning clips from a deleted owner is fine
--      because media_clips.user_id has no FK, but it leaves rows that
--      will fail the next cleanup pass with confusing nulls.
--   c. Remove the ROLLBACK above. Uncomment the entire block below.
--   d. Re-run. The COMMIT at the end makes the deletion durable.
-- =========================================================================
--
-- BEGIN;
--
-- -- Rebuild the temp set (the previous BEGIN/ROLLBACK threw it away).
-- CREATE TEMP TABLE _doomed_auth_ids ON COMMIT DROP AS
-- SELECT au.id AS auth_id, au.email
-- FROM auth.users au
-- WHERE
--     (
--         au.email ILIKE '%test%'
--         OR au.email ILIKE '%maestro%'
--         OR au.email ILIKE '%qa%'
--         OR au.email ILIKE '%dev%'
--         OR au.email ILIKE '%+test%'
--         OR au.email ILIKE '%@example.com'
--         OR au.email ILIKE '%@mailinator.com'
--     )
--     OR au.email IN (
--         'maestro.runner@gmail.com',
--         'fanwave.test1@gmail.com',
--         'fanwave.test2@gmail.com',
--         'fanwave.qa@gmail.com'
--     )
--     OR au.id IN (
--         SELECT u.auth_id
--         FROM public.users u
--         WHERE u.subscription_status IN ('trial', 'active')
--           AND NOT EXISTS (
--               SELECT 1 FROM public.entitlements e
--               WHERE e.user_id = u.auth_id
--           )
--     )
-- AND au.email <> 'fansphere.reviewer@gmail.com';
--
-- -- ─── 4a. Leaf-most rows first (children of children) ─────────────
-- DELETE FROM public.moment_reactions     WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.clip_likes           WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.clip_comments        WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
--
-- -- ─── 4b. Content the user CREATED (rows their user_id authored) ──
-- -- Note: chat_rooms.id is FK-referenced with CASCADE from chat_room_members,
-- -- messages, banned_members, media_clips, match_moments — deleting an
-- -- owned chat_room takes those out automatically (migration 002).
-- DELETE FROM public.media_clips          WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.match_moments        WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.watch_party_invites  WHERE invited_by  IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.watch_party_rsvps    WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.watch_parties        WHERE creator_id  IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.messages             WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.chat_room_members    WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.chat_rooms           WHERE owner_id    IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.banned_members       WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids)
--                                            OR banned_by   IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.user_blocks          WHERE blocker_id  IN (SELECT auth_id FROM _doomed_auth_ids)
--                                            OR blocked_id  IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.content_flags        WHERE flagger_id  IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.moderation_log       WHERE performed_by IN (SELECT auth_id FROM _doomed_auth_ids);
--
-- -- ─── 4c. Social / profile graph rows ─────────────────────────────
-- DELETE FROM public.user_team_follows    WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.user_follows         WHERE follower_id  IN (SELECT auth_id FROM _doomed_auth_ids)
--                                            OR following_id IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.user_badges          WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.user_streaks         WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
--
-- -- Null out referred_by where another (kept) user pointed at a doomed
-- -- one. Cheaper than chasing the graph and the referral_count is
-- -- denormalised anyway.
-- UPDATE public.users
--    SET referred_by = NULL
--  WHERE referred_by IN (SELECT auth_id FROM _doomed_auth_ids);
--
-- -- ─── 4d. Analytics & infra ───────────────────────────────────────
-- DELETE FROM public.analytics_events     WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.rate_limits          WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.notification_log     WHERE ref_id      IN (SELECT auth_id FROM _doomed_auth_ids);
-- -- notification_queue rows reference push_token (not user_id) — skipped
-- -- by design; they'll either send and self-clean or hit the 7-day TTL.
--
-- -- ─── 4e. Entitlements & purchase audit ───────────────────────────
-- -- Migration 040 installed an immutability trigger on entitlements;
-- -- it gates DELETE behind the supabase_admin role. The SQL Editor
-- -- runs as that role, so this works. If you run from psql with a
-- -- different role it will fail with the migration 040 error.
-- DELETE FROM public.entitlements         WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.purchase_events      WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
-- DELETE FROM public.trial_reminders_sent WHERE user_id     IN (SELECT auth_id FROM _doomed_auth_ids);
--
-- -- ─── 4f. Admin / beta tables (these DO have FK CASCADE, but listing
-- --        them lets us count the cascade impact in the audit) ──────
-- DELETE FROM public.admin_roles
--  WHERE user_id IN (
--      SELECT u.id FROM public.users u
--      WHERE u.auth_id IN (SELECT auth_id FROM _doomed_auth_ids)
--  );
-- DELETE FROM public.beta_testers
--  WHERE user_id IN (
--      SELECT u.id FROM public.users u
--      WHERE u.auth_id IN (SELECT auth_id FROM _doomed_auth_ids)
--  );
--
-- -- ─── 4g. public.users, then auth.users ───────────────────────────
-- DELETE FROM public.users
--  WHERE auth_id IN (SELECT auth_id FROM _doomed_auth_ids)
-- RETURNING id, auth_id, display_name;
--
-- DELETE FROM auth.users
--  WHERE id IN (SELECT auth_id FROM _doomed_auth_ids)
-- RETURNING id, email;
--
-- -- ─── 4h. Post-cleanup audit counts ───────────────────────────────
-- SELECT 'post_cleanup_auth_users'   AS metric, COUNT(*) AS value FROM auth.users;
-- SELECT 'post_cleanup_public_users' AS metric, COUNT(*) AS value FROM public.users;
--
-- COMMIT;

-- =========================================================================
-- 5. Manual follow-ups (not handled by this script)
-- =========================================================================
--   - Storage objects in the 'clips' bucket owned by deleted users are
--     left orphaned. Purge via the Storage dashboard or a separate script.
--   - RevenueCat: if any deleted account had a real subscriber record on
--     RevenueCat (you SHOULD have excluded them via the entitlements
--     check, but double-check), use the RC dashboard to delete the
--     subscriber to prevent webhook resurrection.
--   - Re-run grant_reviewer_premium.sql after this script if you somehow
--     blew the reviewer account away. (The reviewer email is hard-excluded
--     above; this is a paranoia step.)
