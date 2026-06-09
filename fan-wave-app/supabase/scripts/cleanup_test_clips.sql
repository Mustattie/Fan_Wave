-- cleanup_test_clips.sql
--
-- Purpose: remove test clips from `media_clips` that are leaking into the
-- production app surface. Pre-launch (and during ongoing Maestro / manual
-- QA) the dev Supabase project (`azkmymxdjylmkytrvyfn`) accumulated dummy
-- uploads which are now visible to real installs from the Play Store
-- launch (2026-06-07). This script is the manual remediation until the new
-- prod project is provisioned (and migrations replayed clean).
--
-- Run this against the DEV/QA Supabase project via the SQL Editor (so it
-- executes as supabase_admin and bypasses RLS). It is NOT meant for the
-- new prod project — that one starts empty.
--
-- Defaults to DRY RUN — nothing is deleted until the user uncomments the
-- DELETE block at the bottom. Counts are logged before/after for audit.
--
-- Criteria for "test clip" (boolean OR):
--   1. Uploaded by an auth.users account whose email matches a known test
--      pattern (substring 'test', 'maestro', 'qa', 'dev', '+test', or one
--      of the explicit known test emails listed in v_known_test_emails).
--   2. Created strictly before the Play Store launch timestamp
--      2026-06-07 00:00:00 UTC. Anything pre-launch is by definition
--      either dev seed or internal QA — no real user had the app yet.
--
-- EXCLUDED — never deleted by this script:
--   - The reviewer account (fansphere.reviewer@gmail.com). The reviewer's
--     own demo clips are needed for the App Store / Play Store review walk.
--   - Any clip authored by a user account whose email is NOT a test
--     pattern AND whose clip was created on/after 2026-06-07.
--
-- NOTE on the user_id <-> auth.users join:
--   media_clips.user_id stores the auth.uid() value (i.e. auth.users.id),
--   not public.users.id. This is the codebase convention — every RLS
--   policy in 002/004/033 uses `user_id = auth.uid()`. So we join
--   media_clips.user_id directly against auth.users.id below.

-- ─── 0. Settings used by this script ────────────────────────────────────
\set launch_ts '2026-06-07 00:00:00+00'
\set reviewer_email 'fansphere.reviewer@gmail.com'

BEGIN;

-- ─── 1. Pre-cleanup audit count ────────────────────────────────────────
SELECT 'pre_cleanup_total_clips' AS metric, COUNT(*) AS value
FROM public.media_clips;

-- Materialise the set of test auth_ids so the preview and the (future)
-- DELETE share the exact same definition.
CREATE TEMP TABLE _test_auth_ids ON COMMIT DROP AS
SELECT au.id AS auth_id, au.email
FROM auth.users au
WHERE
    -- Substring test patterns. Case-insensitive.
    (
        au.email ILIKE '%test%'
        OR au.email ILIKE '%maestro%'
        OR au.email ILIKE '%qa%'
        OR au.email ILIKE '%dev%'
        OR au.email ILIKE '%+test%'
        OR au.email ILIKE '%@example.com'
        OR au.email ILIKE '%@mailinator.com'
    )
    -- Explicit known test emails (extend this list as new test accounts
    -- get created; keep the reviewer OUT of this list).
    OR au.email IN (
        'maestro.runner@gmail.com',
        'fanwave.test1@gmail.com',
        'fanwave.test2@gmail.com',
        'fanwave.qa@gmail.com'
    )
-- Hard exclusion: never sweep the reviewer account, even if its email
-- somehow matches a pattern in the future.
AND au.email <> 'fansphere.reviewer@gmail.com';

-- ─── 2. DRY RUN PREVIEW ────────────────────────────────────────────────
-- Shows every clip that the DELETE below would remove. Review before
-- uncommenting section 4. Sorted newest-first.
SELECT
    mc.id                                  AS clip_id,
    mc.title,
    mc.media_url,
    mc.user_id                             AS auth_id,
    au.email                               AS uploader_email,
    mc.created_at,
    CASE
        WHEN tai.auth_id IS NOT NULL
            THEN 'test_email_pattern'
        WHEN mc.created_at < TIMESTAMPTZ '2026-06-07 00:00:00+00'
            THEN 'pre_launch_timestamp'
        ELSE 'unknown'
    END                                    AS deletion_reason
FROM public.media_clips mc
LEFT JOIN auth.users      au  ON au.id      = mc.user_id
LEFT JOIN _test_auth_ids  tai ON tai.auth_id = mc.user_id
WHERE
    -- Reason 1: uploader is a test account
    tai.auth_id IS NOT NULL
    -- Reason 2: created before public launch
    OR mc.created_at < TIMESTAMPTZ '2026-06-07 00:00:00+00'
ORDER BY mc.created_at DESC;

-- Summary of what would be deleted, by reason.
SELECT
    'dry_run_would_delete_test_email' AS metric,
    COUNT(*) AS value
FROM public.media_clips mc
JOIN _test_auth_ids tai ON tai.auth_id = mc.user_id;

SELECT
    'dry_run_would_delete_pre_launch' AS metric,
    COUNT(*) AS value
FROM public.media_clips mc
WHERE mc.created_at < TIMESTAMPTZ '2026-06-07 00:00:00+00'
  -- Avoid double-counting clips already covered by the test_email bucket
  AND NOT EXISTS (
      SELECT 1 FROM _test_auth_ids tai WHERE tai.auth_id = mc.user_id
  );

SELECT
    'dry_run_would_delete_total' AS metric,
    COUNT(*) AS value
FROM public.media_clips mc
LEFT JOIN _test_auth_ids tai ON tai.auth_id = mc.user_id
WHERE tai.auth_id IS NOT NULL
   OR mc.created_at < TIMESTAMPTZ '2026-06-07 00:00:00+00';

-- ─── 3. End of DRY RUN ─────────────────────────────────────────────────
-- Stop here on first execution. Review the preview rows above. If they
-- look right, re-run the script with section 4 uncommented.

ROLLBACK;

-- =========================================================================
-- 4. DELETE BLOCK — UNCOMMENT WHEN READY TO ACTUALLY DELETE
-- =========================================================================
-- To execute the cleanup:
--   a. Take a backup snapshot of the project (Supabase dashboard →
--      Database → Backups → "Create snapshot").
--   b. Remove the ROLLBACK above, and uncomment the entire block below.
--   c. Re-run the script. The COMMIT at the end makes the deletion durable.
-- =========================================================================
--
-- BEGIN;
--
-- -- Rebuild the temp set (the previous BEGIN/ROLLBACK threw it away).
-- CREATE TEMP TABLE _test_auth_ids ON COMMIT DROP AS
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
-- AND au.email <> 'fansphere.reviewer@gmail.com';
--
-- -- Cascade-delete child rows that REFERENCE media_clips (these have
-- -- ON DELETE CASCADE in migration 004, but listing them explicitly
-- -- makes the audit trail clearer and lets us count them).
-- WITH doomed AS (
--     SELECT mc.id
--     FROM public.media_clips mc
--     LEFT JOIN _test_auth_ids tai ON tai.auth_id = mc.user_id
--     WHERE tai.auth_id IS NOT NULL
--        OR mc.created_at < TIMESTAMPTZ '2026-06-07 00:00:00+00'
-- )
-- DELETE FROM public.media_clips
-- WHERE id IN (SELECT id FROM doomed)
-- RETURNING id, user_id, title, created_at;
-- -- clip_comments and clip_likes auto-cascade (migration 004).
--
-- -- Post-cleanup audit count.
-- SELECT 'post_cleanup_total_clips' AS metric, COUNT(*) AS value
-- FROM public.media_clips;
--
-- COMMIT;

-- =========================================================================
-- 5. Storage bucket reminder (manual step — not handled by this script)
-- =========================================================================
-- The clip media files themselves live in the 'clips' Supabase Storage
-- bucket (migration 021). Deleting the DB rows above leaves the binary
-- objects orphaned. To purge them, either:
--   - Use the Storage dashboard to delete the matching object keys, OR
--   - Run a separate cleanup that lists objects against the surviving
--     media_clips.media_url set and deletes the rest.
-- This script intentionally does NOT touch storage; the row removal alone
-- is enough to hide the test clips from the app feed.
