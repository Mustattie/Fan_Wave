-- 073: v9.1 UAT — RSVP RPC hardening (delete-on-cancel + count reconciliation)
--
-- BUG (UAT 2026-07-18)
-- ────────────────────
-- User tapped RSVP on a watch party. Local UI flipped to "Going" but two
-- server-backed surfaces stayed stale:
--   (a) Home → Watch Parties Near You card still shows old going count
--   (b) Profile → RSVP History still shows "No watch parties on your
--       calendar yet"
--
-- ROOT CAUSE
-- ──────────
-- Migration 063's rsvp_to_watch_party() converts p_status='cancelled' →
-- 'none' before INSERT, but watch_party_rsvps.status CHECK constraint
-- (migration 002 line 71) only allows ('going','interested','declined').
-- The insert fails with a 23514 check-constraint violation, transaction
-- rolls back, rsvp_count never updates, no row exists to list in history.
--
-- The client (WatchPartyCard.tsx) treats the RPC as fire-and-forget for
-- optimistic UI — so the button flips regardless of server outcome.
-- Everything else that reads the table is empty.
--
-- FIX
-- ───
-- Rewrite the RPC to DELETE the row when p_status is 'cancelled' / 'none'
-- rather than trying to store a placeholder status. RSVP history query at
-- app/rsvp-history.tsx naturally excludes cancelled RSVPs this way, and
-- rsvp_count recompute reflects reality.
--
-- Also: keep the constraint tight (only real statuses) so future code
-- can't insert junk values.

BEGIN;

DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rsvp_to_watch_party(UUID, TEXT);

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
  v_is_cancel  BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('going', 'interested', 'declined', 'none', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  v_is_cancel := p_status IN ('none', 'cancelled');

  SELECT wp.event_id, wp.capacity, wp.rsvp_count
    INTO v_event_id, v_capacity, v_rsvp_count
    FROM public.watch_parties wp
   WHERE wp.id = p_party_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'watch party not found' USING ERRCODE = '42P01';
  END IF;

  -- WC pass gate — only applied to affirmative RSVPs on WC watch parties.
  IF v_event_id = 'e0000000-0000-0000-0000-000000002026'::UUID
     AND p_status IN ('going', 'interested')
     AND NOT public.has_wc_access(v_user_id) THEN
    RAISE EXCEPTION 'wc_pass_required' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'going' AND v_rsvp_count IS NOT NULL
     AND v_capacity IS NOT NULL AND v_rsvp_count >= v_capacity THEN
    RAISE EXCEPTION 'Watch party is at capacity' USING ERRCODE = '53400';
  END IF;

  IF v_is_cancel THEN
    -- Cancel = remove the row. History queries filter on user_id, so
    -- an absent row is the correct representation of "not attending".
    DELETE FROM public.watch_party_rsvps
     WHERE watch_party_id = p_party_id AND user_id = v_user_id
     RETURNING * INTO v_rsvp;
    -- If no row existed we still return a synthetic empty record so the
    -- client's .single() call doesn't 406.
    IF NOT FOUND THEN
      v_rsvp.id             := gen_random_uuid();
      v_rsvp.watch_party_id := p_party_id;
      v_rsvp.user_id        := v_user_id;
      v_rsvp.status         := 'declined';
      v_rsvp.created_at     := now();
    END IF;
  ELSE
    INSERT INTO public.watch_party_rsvps (watch_party_id, user_id, status)
    VALUES (p_party_id, v_user_id, p_status)
    ON CONFLICT (watch_party_id, user_id)
      DO UPDATE SET status = EXCLUDED.status
    RETURNING * INTO v_rsvp;
  END IF;

  -- Recompute the denormalized going count from truth. Cheap because
  -- watch_party_rsvps is indexed on (watch_party_id).
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
GRANT EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) TO service_role;

-- One-time reconciliation: any watch_parties row whose rsvp_count
-- drifted from truth (because prior 'cancelled'→'none' inserts silently
-- failed) gets snapped to reality.
UPDATE public.watch_parties wp
   SET rsvp_count = COALESCE(sub.c, 0)
  FROM (
    SELECT watch_party_id, count(*) AS c
      FROM public.watch_party_rsvps
     WHERE status = 'going'
     GROUP BY watch_party_id
  ) sub
 WHERE wp.id = sub.watch_party_id
   AND wp.rsvp_count IS DISTINCT FROM sub.c;

UPDATE public.watch_parties wp
   SET rsvp_count = 0
 WHERE wp.rsvp_count > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.watch_party_rsvps r
      WHERE r.watch_party_id = wp.id AND r.status = 'going'
   );

NOTIFY pgrst, 'reload schema';
COMMENT ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT)
  IS 'v9.1 fix: delete-on-cancel (was silently 23514ing on status=none).';

COMMIT;
