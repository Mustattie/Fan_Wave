-- 059: Close server-side WC-pass bypass + repair rsvp_to_watch_party signature.
--
-- TWO BUGS rolled up.
--
-- Bug A (silent server-side bypass)
-- ─────────────────────────────────
-- The `rsvp_to_watch_party` RPC is SECURITY DEFINER, so it bypasses the
-- `watch_party_rsvps_insert` RLS policy added in migration 053. That
-- policy enforces:
--   user_id = auth.uid()
--   AND (party is not the Soccer Cup event OR caller has WC Pass)
-- Because SECURITY DEFINER runs as the function owner (postgres),
-- the RLS WITH CHECK never fires — meaning a client that called the
-- RPC successfully could RSVP a Soccer Cup party without WC Pass.
-- This is the server-side hole the UX paywalls hide but do not close.
--
-- Bug B (every call has been silently 404-ing)
-- ───────────────────────────────────────────
-- The deployed signature is the 3-arg overload from migration 008:
--   rsvp_to_watch_party(p_party_id UUID, p_user_id UUID, p_status TEXT)
-- All three client call sites pass only TWO args:
--   - components/WatchPartyCard.tsx     → p_party_id + p_status
--   - app/watch-party/[id].tsx           → p_party_id + p_status
--   - components/WCWatchParties.tsx      → p_watch_party_id + p_status   ← wrong name
-- PostgREST returns 404 for any signature that doesn't resolve, and the
-- catch blocks swallow the error to `console.warn`. That's why Bug A
-- went unnoticed in the wild — nobody could RSVP anyway. The next time
-- the UI fix lands without this migration, the bypass becomes reachable.
--
-- FIX (this migration)
-- ────────────────────
--   1. DROP the legacy 3-arg overload entirely. Anything still calling
--      it would have been broken; nothing in the active client uses it.
--   2. Create a single canonical 2-arg overload that reads auth.uid()
--      internally — matches what all three call sites already pass.
--   3. Inline the WC-pass check using has_wc_access() (migration 053).
--      Mirrors the RLS policy predicate exactly so callers cannot use
--      the RPC as a bypass route.
--   4. Raise PostgreSQL exceptions with explicit SQLSTATEs so the
--      client can branch on the WC-pass case (42501) the same way it
--      already does for RLS 42501 errors — and the WCPassPaywall path
--      added by Agent A in the v8.2 sweep keeps working server-side.
--   5. Companion client edit (NOT in this SQL — see commit message):
--      components/WCWatchParties.tsx line 153 renames p_watch_party_id
--      to p_party_id so the call resolves the new signature.

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

  -- Accept the client's status vocabulary. 'cancelled' is the
  -- watch-party/[id].tsx default; treat it as 'none' downstream so the
  -- existing RSVP-count denormaliser stays correct (only 'going' rows
  -- count toward capacity).
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

  -- WC-pass server-side gate. Mirrors the migration 053
  -- watch_party_rsvps_insert RLS policy predicate. SECURITY DEFINER
  -- bypasses RLS, so we re-assert the check inside the RPC body.
  -- Only positive-intent statuses are gated; a user can still set
  -- 'declined' / 'none' / 'cancelled' to clear a previous RSVP even
  -- without WC Pass, which matches the UX flow.
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

  -- Recompute the rsvp_count denormaliser. Cheap because of the index
  -- on watch_party_rsvps(watch_party_id, status) from earlier migrations.
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

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname = 'rsvp_to_watch_party';
--   -- expect a single row: rsvp_to_watch_party(p_party_id uuid, p_status text)
