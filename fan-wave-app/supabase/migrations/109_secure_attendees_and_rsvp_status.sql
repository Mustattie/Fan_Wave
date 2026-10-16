-- SKYC-123/124/142: preserve RPC signatures for installed clients.
-- No row cleanup/backfill; deploy only after reviewed staging verification.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.get_watch_party_attendees_v2(p_party_id UUID, p_viewer_id UUID)
RETURNS TABLE (id UUID, user_id UUID, status TEXT, display_name TEXT,
  is_host BOOLEAN, total_going INT, total_maybe INT, total_cant_go INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid UUID := auth.uid();
  v_creator UUID;
  v_visibility TEXT;
  v_host BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  -- p_viewer_id is retained for API compatibility and NEVER used as identity.
  SELECT wp.creator_id, wp.visibility INTO v_creator, v_visibility
  FROM public.watch_parties wp
  WHERE wp.id = p_party_id
    AND (wp.moderation_status != 'removed' OR wp.creator_id = v_uid)
    AND wp.creator_id NOT IN (SELECT public.blocked_user_ids());
  IF NOT FOUND THEN RETURN; END IF;
  v_host := v_creator = v_uid;
  -- A private party cannot disclose totals/roster to an unrelated caller.
  IF v_visibility = 'private' AND NOT v_host AND NOT EXISTS (
    SELECT 1 FROM public.watch_party_rsvps r
    WHERE r.watch_party_id = p_party_id AND r.user_id = v_uid
  ) THEN RETURN; END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT count(*) FILTER (WHERE r.status = 'going')::INT AS going,
           count(*) FILTER (WHERE r.status = 'interested')::INT AS maybe,
           count(*) FILTER (WHERE r.status = 'declined')::INT AS declined
    FROM public.watch_party_rsvps r WHERE r.watch_party_id = p_party_id
  ), visible AS (
    SELECT r.id, r.user_id, r.status, COALESCE(u.display_name, 'User') AS display_name, r.created_at
    FROM public.watch_party_rsvps r LEFT JOIN public.users u ON u.auth_id = r.user_id
    WHERE r.watch_party_id = p_party_id
      AND ((v_host AND v_visibility = 'private') OR r.status = 'going' OR r.user_id = v_uid)
  )
  SELECT v.id, v.user_id, v.status, v.display_name, v_host,
         t.going, t.maybe, t.declined
  FROM totals t LEFT JOIN visible v ON TRUE
  ORDER BY CASE v.status WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END, v.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) TO authenticated;
COMMENT ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) IS
  'Identity from auth.uid only; legacy viewer argument ignored. Authorized roster plus own RSVP, canonical declined totals. SKYC-123/124/142.';

-- RSVP write definition appended below; keep existing capacity/entitlement/trigger behavior.


CREATE OR REPLACE FUNCTION public.rsvp_to_watch_party(
  p_party_id UUID,
  p_status   TEXT
)
RETURNS public.watch_party_rsvps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id    UUID;
  v_event_id   UUID;
  v_capacity   INT;
  v_rsvp_count INT;
  v_rsvp       public.watch_party_rsvps;
  v_is_cancel  BOOLEAN;
BEGIN
  -- Installed build 37 sends cant_go; normalize at the boundary.
  p_status := CASE WHEN p_status = 'cant_go' THEN 'declined' ELSE p_status END;
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


REVOKE EXECUTE ON FUNCTION public.rsvp_to_watch_party(UUID, TEXT) FROM PUBLIC, anon;
NOTIFY pgrst, 'reload schema';
COMMIT;
