-- 062: v8.6 stale-data cleanup + RSVP RPC redeploy
--
-- Three problems this migration fixes, all symptoms of the same upstream
-- failure (ESPN cron pipeline silently broken since the vault drift
-- described in migration 060's header):
--
--   (A) "Could not find the function public.rsvp_to_watch_party
--        (p_party_id, p_status) in the schema cache" — prod RSVP alert
--       observed 2026-06-20 UAT. Migration 059 defined this RPC but it
--       appears never to have hit prod, or got rolled back. Re-applied
--       here idempotently.
--
--   (B) Soccer Cup tab shows Wales/Chile/USA as past FINALs on Jun 10/11
--       even though those fixtures never happened. Migration 060 wiped
--       the seeded WC matches but ESPN sync hasn't repopulated, so the
--       UI is rendering whatever leftover seed rows survived (or were
--       re-inserted).
--
--   (C) "Even today's games on the home page are stale" — same shape as
--       (B). Without a working cron, the games table holds whatever was
--       last written, often from the dev environment seed.
--
-- This migration is safe to re-run. Each step is idempotent.

-- ─── Step 1: RSVP RPC (re-applies migration 059) ─────────────────────
-- DROP cascades the legacy 3-arg overload if it still exists alongside.
DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.rsvp_to_watch_party(
  p_party_id UUID,
  p_status   TEXT
)
RETURNS public.watch_party_rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_event_id   UUID;
  v_capacity   INT;
  v_rsvp_count INT;
  v_rsvp       public.watch_party_rsvps;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('going', 'interested', 'declined', 'none', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT wp.event_id, wp.capacity, wp.rsvp_count
    INTO v_event_id, v_capacity, v_rsvp_count
    FROM public.watch_parties wp
   WHERE wp.id = p_party_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'watch party not found' USING ERRCODE = '42P01';
  END IF;

  -- Soccer-Cup WC-pass gate (mirrors migration 053 RLS predicate).
  IF v_event_id = 'e0000000-0000-0000-0000-000000002026'::UUID
     AND p_status IN ('going', 'interested')
     AND NOT public.has_wc_access(v_user_id) THEN
    RAISE EXCEPTION 'wc_pass_required' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'going' AND v_rsvp_count IS NOT NULL
     AND v_capacity IS NOT NULL AND v_rsvp_count >= v_capacity THEN
    RAISE EXCEPTION 'Watch party is at capacity' USING ERRCODE = '53400';
  END IF;

  INSERT INTO public.watch_party_rsvps (watch_party_id, user_id, status)
  VALUES (
    p_party_id,
    v_user_id,
    CASE WHEN p_status = 'cancelled' THEN 'none' ELSE p_status END
  )
  ON CONFLICT (watch_party_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING * INTO v_rsvp;

  UPDATE public.watch_parties
     SET rsvp_count = (
       SELECT count(*) FROM public.watch_party_rsvps
        WHERE watch_party_id = p_party_id AND status = 'going'
     )
   WHERE id = p_party_id;

  RETURN v_rsvp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO authenticated;

-- ─── Step 2: WC seeded fixtures wipe (re-applies migration 060) ──────
-- Null FK from watch_parties to seeded games first.
UPDATE public.watch_parties wp
   SET game_id = NULL
  FROM public.games g
 WHERE wp.game_id = g.id
   AND g.event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
   AND g.espn_id IS NULL;

-- Defensive null of any other FKs pointing at seeded games.
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
      AND tc.table_name <> 'watch_parties'
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

DELETE FROM public.games
 WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
   AND espn_id IS NULL;

-- ─── Step 3: NEW — wipe stale non-ESPN games (Today's Games carousel) ─
-- `espn_id IS NULL` is the seed-pattern fingerprint for every league we
-- carry; real ESPN-synced rows always carry an espn_id (migration 003+
-- conventions plus the sync-game-schedules edge function output).
--
-- This nulls cross-FK references first (same as WC pattern) so the DELETE
-- doesn't trip integrity. Defensive — no FK should currently constrain a
-- non-WC game row, but the dynamic scan covers future schema additions.
UPDATE public.watch_parties wp
   SET game_id = NULL
  FROM public.games g
 WHERE wp.game_id = g.id
   AND g.espn_id IS NULL;

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
      AND tc.table_name <> 'watch_parties'
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = NULL WHERE %I IN (
         SELECT id FROM public.games WHERE espn_id IS NULL
       )',
      r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;

DELETE FROM public.games WHERE espn_id IS NULL;

-- Reload PostgREST schema cache so the new RPC is callable immediately.
NOTIFY pgrst, 'reload schema';

-- ─── Verification queries (run in Studio after apply) ─────────────────
--
--   -- RSVP RPC exists at the correct signature
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'rsvp_to_watch_party';
--
--   -- All games rows now have an espn_id
--   SELECT count(*) FILTER (WHERE espn_id IS NULL) AS stale,
--          count(*) FILTER (WHERE espn_id IS NOT NULL) AS live
--     FROM public.games;
--   -- expect stale=0 immediately after; live grows as cron resumes
--
--   -- WC fixtures
--   SELECT count(*) FROM public.games
--    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;
--   -- expect 0 right after; grows as espn_sync_worldcup_fast fires
--
-- ─── OPERATOR ACTIONS (cron pipeline, NOT in SQL) ─────────────────────
-- The ESPN sync has been silently failing since the CRON_SHARED_SECRET
-- vs vault.fan_wave_service_role_key drift described in migration 060.
-- After applying this migration:
--   1. supabase secrets set GOOGLE_PLACES_API_KEY="..." (new for v8.6
--      venue-search edge function)
--   2. supabase secrets set CRON_SHARED_SECRET="..." (same secret as in
--      vault.fan_wave_service_role_key — see runbook in mig 060 header)
--   3. supabase functions deploy sync-game-schedules
--   4. Wait ~5 min then re-run the verification queries above.
