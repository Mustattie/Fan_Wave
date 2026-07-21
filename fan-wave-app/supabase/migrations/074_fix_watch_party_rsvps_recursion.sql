-- 074: Fix infinite recursion in watch_party_rsvps SELECT policy (v9.1 UAT)
--
-- WHY:
--   v9.1 UAT 2026-07-21 (Expo Go client log):
--     WARN [useMyRsvps] query error 42P17 infinite recursion detected in
--                        policy for relation "watch_party_rsvps"
--
--   The offending policy has been in prod since migration 007. Its third
--   USING branch reads FROM watch_party_rsvps inside a policy ON
--   watch_party_rsvps -- Postgres detects this at plan time and refuses to
--   run the query at all. Symptom stayed silent until v8.7 introduced
--   useMyRsvps(), which is the first client hook to issue a SELECT that
--   trips the recursive branch (previous callers all short-circuited on
--   user_id = auth.uid() or came via SECURITY DEFINER RPCs).
--
--   Same escape hatch that mig 051 used for chat_room_members: hoist the
--   self-referencing subquery into a SECURITY DEFINER helper. RLS does not
--   re-apply inside a SECURITY DEFINER function, so the inner query runs
--   as the function owner and the outer policy has no self-reference to
--   recurse into.
--
-- WHAT:
--   1. Create SECURITY DEFINER helper _user_is_party_attendee(party_id, user_id).
--   2. Drop + recreate watch_party_rsvps_select using the helper for the
--      "attendee sees fellow attendees" branch. First two branches
--      unchanged (own RSVPs + creator view).
--
-- No user-facing behaviour change vs the intent of mig 007 -- this
-- restores what mig 007 was supposed to allow, minus the crash.
--
-- Idempotent. Safe to replay.

BEGIN;

-- ─── 1. Recursion-breaking helper ──────────────────────────────────
-- STABLE + SECURITY DEFINER lets the planner cache the result within a
-- statement and skips RLS on the inner scan, so no self-reference.
CREATE OR REPLACE FUNCTION public._user_is_party_attendee(
  p_party_id UUID,
  p_user_id  UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.watch_party_rsvps
     WHERE watch_party_id = p_party_id
       AND user_id        = p_user_id
       AND status         = 'going'
  );
$$;

REVOKE EXECUTE ON FUNCTION public._user_is_party_attendee(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public._user_is_party_attendee(UUID, UUID) TO authenticated;

-- ─── 2. Rewrite the SELECT policy ──────────────────────────────────
DROP POLICY IF EXISTS watch_party_rsvps_select ON public.watch_party_rsvps;
CREATE POLICY watch_party_rsvps_select ON public.watch_party_rsvps
  FOR SELECT TO authenticated
  USING (
    -- Own RSVPs (the useMyRsvps hot path -- also short-circuits the
    -- recursion detector even without the helper).
    user_id = auth.uid()
    -- Party creators see every RSVP on their party.
    OR watch_party_id IN (
      SELECT id FROM public.watch_parties WHERE creator_id = auth.uid()
    )
    -- Fellow attendees can see each other's RSVPs on the same party.
    -- Uses the SECURITY DEFINER helper so this branch does not
    -- self-reference watch_party_rsvps at plan time.
    OR public._user_is_party_attendee(watch_party_id, auth.uid())
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   -- Should return without 42P17 now:
--   SELECT id, watch_party_id, status FROM public.watch_party_rsvps
--    WHERE user_id = (SELECT id FROM auth.users WHERE email='mustattie@gmail.com')
--    LIMIT 5;
--
--   -- Helper is present + granted:
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = '_user_is_party_attendee';
--   -- expect: prosecdef = t
