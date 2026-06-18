-- 060: Remove migration-006 seeded WC 2026 fixtures so the real
-- ESPN-synced fixtures can populate cleanly.
--
-- Migration 006 seeded 104 placeholder matches BEFORE the actual
-- 2026 World Cup draw was held. After the draw (Dec 2025) several
-- seeded matches reference teams that did not qualify (Bolivia,
-- Thailand, Costa Rica vs other groupings, etc.). User UAT report:
-- the Soccer Cup tab is showing "Ivory Coast vs Bolivia", "Ivory
-- Coast vs Thailand", "Argentina vs Australia (Group E)" and other
-- post-draw-inaccurate fixtures. These come from the seed; ESPN
-- sync only UPSERTs on espn_id and never deletes pre-existing rows.
--
-- This migration deletes ONLY the seeded games (event_id = WC event
-- AND espn_id IS NULL). Real ESPN-synced games (espn_id NOT NULL)
-- and any user-created watch parties remain untouched. A foreign-key
-- wrinkle (watch_parties.game_id REFERENCES games(id)) means we have
-- to NULL out those refs first, then delete. We also defensively walk
-- ALL FKs pointing at games(id) and null any seeded-game references.
--
-- COMPANION FIX (NOT in this SQL — operator action required):
-- The sync-game-schedules edge function had been 401-ing every cron
-- call for ~8 days because the vault-stored service_role_key (from
-- 2026-05-18, dev project) doesn't match the prod env CRON_SHARED_
-- SECRET. To actually populate real fixtures after this migration:
--
--   1. Pick a strong random secret (or reuse the current prod
--      service_role_key from Dashboard → Project Settings → API).
--   2. supabase secrets set CRON_SHARED_SECRET="<secret>" \
--        --project-ref fwlfiejvxmslkpoojggs
--   3. Apply this one-liner via Studio SQL editor:
--        SELECT vault.update_secret(
--          (SELECT id FROM vault.secrets
--            WHERE name = 'fan_wave_service_role_key'),
--          '<secret>',
--          'fan_wave_service_role_key'
--        );
--   4. Wait ~2 minutes — the espn_sync_worldcup_fast cron will fire
--      and populate real WC fixtures into public.games.
--
-- The edge function source was also updated in this change set to
-- accept SUPABASE_SERVICE_ROLE_KEY as a secondary bearer, so even
-- without step (1) above, IF the user redeploys the function the
-- cron will start working using the auto-injected service-role JWT.

-- Step 1: null out FK references from watch_parties pointing at
-- seeded games.
UPDATE public.watch_parties wp
   SET game_id = NULL
  FROM public.games g
 WHERE wp.game_id = g.id
   AND g.event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
   AND g.espn_id IS NULL;

-- Step 2: null any OTHER FK references to seeded games (defensive —
-- catches match_moments, clips, or anything else nullable that might
-- point at games).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'games'
      AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
      AND tc.table_name <> 'watch_parties'  -- handled above
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = NULL WHERE %I IN (
         SELECT id FROM public.games
          WHERE event_id = %L::uuid AND espn_id IS NULL
       )',
      r.table_name, r.column_name, r.column_name,
      'e0000000-0000-0000-0000-000000002026'
    );
  END LOOP;
END $$;

-- Step 3: delete the seeded fake games.
DELETE FROM public.games
 WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
   AND espn_id IS NULL;

-- Verify with:
--   SELECT count(*) FROM public.games
--    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;
--   -- expect 0 immediately after this migration; grows as pg_cron's
--   -- espn_sync_worldcup_fast (every 2 min, 2026-06-11..2026-07-19)
--   -- populates real ESPN fixtures — IF the CRON_SHARED_SECRET /
--   -- vault alignment described in the header has been done.
