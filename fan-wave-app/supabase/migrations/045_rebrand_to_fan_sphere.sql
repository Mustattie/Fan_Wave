-- 045: rebrand-related data cleanup — Fan Wave → Fan Sphere.
--
-- All visible app text, configs, and docs were updated in the rename commit,
-- but a few production-data items had the old name baked in via earlier
-- migrations:
--
--   1. users.display_name DEFAULT 'Fan Wave User' (set in combined_migrations
--      _007_016.sql) — every new signup without a display_name would get
--      that default and surface the old brand
--   2. Existing user rows that already received the default
--   3. badges table descriptions referencing "Fan Wave"
--
-- This migration is a forward-only data fix. Historical migration files
-- stay unchanged (modifying them would desync from Supabase's migration
-- tracker), so the historical "Fan Wave" references in 001-044 are
-- intentionally left alone — they're context for when each piece was
-- added, not live brand text.

-- ─── 1. users.display_name default + existing default rows ─────────
ALTER TABLE users ALTER COLUMN display_name SET DEFAULT 'Fan Sphere User';

UPDATE users
SET display_name = 'Fan Sphere User'
WHERE display_name = 'Fan Wave User';

-- ─── 2. badges table descriptions ──────────────────────────────────
-- Generic REPLACE so any badge with "Fan Wave" in its description gets
-- updated, not just the two known ones (early_adopter, recruiter).
UPDATE badges
SET description = REPLACE(description, 'Fan Wave', 'Fan Sphere')
WHERE description LIKE '%Fan Wave%';

-- ─── Verify ────────────────────────────────────────────────────────
-- Expect zero rows for both:
--   SELECT id, display_name FROM users WHERE display_name LIKE '%Fan Wave%';
--   SELECT key, description FROM badges WHERE description LIKE '%Fan Wave%';
--
-- Confirm the default rotated:
--   SELECT column_default FROM information_schema.columns
--   WHERE table_name='users' AND column_name='display_name';
--   -- expect: 'Fan Sphere User'::text
