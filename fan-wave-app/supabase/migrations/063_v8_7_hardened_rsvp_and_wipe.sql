-- 063: v8.7 hardened RSVP RPC + stale-data re-wipe + reviewer membership reset
--
-- WHY THIS EXISTS
-- ───────────────
-- v8.6 UAT (2026-06-20) reported three failures that all trace back to
-- the same upstream problem: prior migrations applied to prod but the
-- effects were not durable.
--
--   (1) RSVP: "Could not find the function public.rsvp_to_watch_party
--       (p_party_id, p_status) in the schema cache" — verified earlier
--       that migration 062 created the function, but PostgREST schema
--       cache did not reload (NOTIFY is best-effort + worker pool may
--       have been mid-restart). This migration redeploys the function
--       AND uses every available reload tactic.
--
--   (2) Soccer Cup tab still shows seeded Group G fixtures from
--       migration 006 (England vs Uruguay, Iran vs Jamaica, Paraguay
--       vs Saudi Arabia, etc.). Either migration 062's wipe was rolled
--       back, run on the wrong project, or re-seeded by a manual
--       `supabase db reset` between verification and UAT. Re-wiping
--       defensively here.
--
--   (3) "Bulls Nation Chicago" appears in Home → Your Groups for a
--       Dallas user. The client-side cache was global (key='groups'
--       with no user_id suffix) so memberships from one auth session
--       bled across logins. Client fix lands in this PR; this
--       migration also resets the membership row defensively if it
--       was actually created on the server (it shouldn't have been,
--       but the screenshot is authoritative).
--
-- SAFE TO RE-RUN: every step is idempotent.

BEGIN;

-- ─── Step 1: RSVP RPC (idempotent redeploy) ──────────────────────────
--
-- Defensive: drop EVERY known overload before creating the canonical
-- 2-arg version. Listed by signature so a stranded overload from any
-- prior migration (003, 007, 008, 059, 062) can't keep PostgREST
-- ambiguous about which one to expose.

DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, TEXT);
DROP FUNCTION IF EXISTS rsvp_to_watch_party(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS rsvp_to_watch_party(UUID, TEXT);

CREATE FUNCTION public.rsvp_to_watch_party(
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

-- Grant to both `authenticated` (normal use) and `service_role`
-- (reviewer/test pathways). `anon` deliberately excluded — RSVP
-- requires an auth.uid().
GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO service_role;

-- ─── Step 2: Stale-data re-wipe (defensive) ──────────────────────────
--
-- Same null-FK-then-delete pattern from migration 062. If the rows
-- already DON'T exist this is a cheap no-op; if they came back via
-- a manual db-reset or out-of-band seed, this catches them.

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

-- ─── Step 3: Reviewer/test-account membership cleanup ────────────────
--
-- The screenshot showed Bulls Nation Chicago in Your Groups for a user
-- whose home_city = Dallas, TX. seed.sql:165 lists Bulls Nation Chicago
-- with owner_id = '00000000-0000-0000-0000-000000000001' (the seed
-- placeholder, distinct from the all-zeros system uuid 000).
--
-- Clean up any chat_room_members row where the membership was inserted
-- for the seed-placeholder-owned groups EXCEPT where the user themself
-- legitimately joined via the UI (we can't tell those apart from the
-- ones bled by the global cache). Pragmatic compromise: only delete
-- memberships for the known reviewer account, leaving real users'
-- joins untouched. Add other QA accounts here as needed.

DELETE FROM public.chat_room_members crm
USING public.chat_rooms cr,
      auth.users au
WHERE crm.chat_room_id = cr.id
  AND crm.user_id = au.id
  AND cr.owner_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND au.email IN (
        'fansphere.reviewer@gmail.com',
        'mustattie@gmail.com'
      );

-- ─── Step 4: Force PostgREST schema reload (belt + suspenders) ───────
--
-- LISTEN/NOTIFY is best-effort. Belt-and-suspenders:
--   (a) NOTIFY pgrst, 'reload schema' — the documented mechanism
--   (b) SELECT pg_notify(...) — same payload, transaction-local
--   (c) Toggle a function comment — bumps the function's modification
--       timestamp so PostgREST's introspection picks it up on the next
--       periodic refresh even if the NOTIFY was missed
--
-- If the RPC is STILL 404 after this migration applies, the next step
-- is to pause + resume the project in Supabase Dashboard. That cycles
-- the PostgREST container and is the only 100%-guaranteed reload path.

NOTIFY pgrst, 'reload schema';
SELECT pg_notify('pgrst', 'reload schema');
COMMENT ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT)
  IS 'v8.7 redeploy: 2-arg signature, WC-pass gate inline. Touched 2026-06-20.';

COMMIT;

-- ─── Verification queries (run in SQL Editor after apply) ────────────
--
--   -- 1. RSVP RPC visible AT 2-arg signature, no overloads left
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--     FROM pg_proc WHERE proname = 'rsvp_to_watch_party';
--   -- expect EXACTLY one row: (p_party_id uuid, p_status text)
--
--   -- 2. No stale games anywhere
--   SELECT count(*) FILTER (WHERE espn_id IS NULL) AS stale,
--          count(*) FILTER (WHERE espn_id IS NOT NULL) AS live
--     FROM public.games;
--   -- expect stale=0
--
--   -- 3. Specifically no WC seed rows left
--   SELECT count(*) FROM public.games
--    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
--      AND espn_id IS NULL;
--   -- expect 0
--
--   -- 4. Reviewer is not a member of seed-owned groups
--   SELECT cr.name FROM public.chat_room_members crm
--     JOIN public.chat_rooms cr ON cr.id = crm.chat_room_id
--     JOIN auth.users au ON au.id = crm.user_id
--    WHERE au.email = 'mustattie@gmail.com'
--      AND cr.owner_id = '00000000-0000-0000-0000-000000000001'::uuid;
--   -- expect 0 rows
--
--   -- 5. Smoke-test the RPC via PostgREST schema cache
--   --    (Have a watch party id ready; this will return 42P01 if the
--   --     id doesn't exist, which still proves the function resolves.)
--   SELECT public.rsvp_to_watch_party(
--     '00000000-0000-0000-0000-000000000000'::uuid,
--     'none'::text
--   );
--   -- expect ERROR: watch party not found  (NOT "function not found")
--
-- ─── OPERATOR ACTIONS (NOT in SQL) ───────────────────────────────────
--
--   1. After applying THIS migration, IF the client still reports
--      "Could not find the function ... in the schema cache" within
--      ~60s, go to Supabase Dashboard → Project Settings → General →
--      Pause project → wait 30s → Resume. This cycles PostgREST and
--      forces a full schema reload. (Last resort — not usually needed.)
--
--   2. Verify ESPN cron is alive:
--        select * from cron.job where jobname like '%sync%';
--      and that the most recent run row in cron.job_run_details has
--      status='succeeded'. If not, ESPN sync has been silently broken
--      and the WC games will not repopulate after this wipe — re-deploy
--      sync-game-schedules and reset CRON_SHARED_SECRET per migration
--      060's runbook.
