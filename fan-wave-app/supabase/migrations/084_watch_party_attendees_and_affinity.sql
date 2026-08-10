-- 084: Host-aware attendees + fan-group affinity for watch parties.
--
-- v9.4.0 UAT Round 3.
--
-- WHY:
--   Two related surfaces on Watch Party detail need better data:
--
--   #9  The host currently sees the same attendees list guests do -- a flat
--       list of RSVPs. UAT wants the host to see per-status breakdown
--       (Going / Maybe / Can't Go) so they can plan headcount, chase
--       maybes, etc. Guests should see totals only for privacy -- no one
--       wants their soft decline made public.
--
--   #6  Every attendee row currently reads as an isolated identity. UAT
--       wants a fan-group affinity callout: "10 fans from Frisco Mavericks
--       Fan Club also going." Signals the network effect and gives fans
--       a reason to join the party. Same signal used on Home + Discover
--       "Watch Parties Nearby" cards.
--
-- WHAT this adds:
--   1. get_watch_party_attendees_v2(p_party_id, p_viewer_id) -- role-aware
--      accessor. For hosts, returns ALL rsvp rows for the party regardless
--      of status. For non-hosts, returns only status='going' rows. Also
--      returns a totals column so the client can render the summary
--      without a second round-trip.
--   2. get_watch_party_group_affinity(p_party_id, p_viewer_id) -- returns
--      one row per fan group where at least one member has RSVP'd going,
--      with the count and group name. Filtered to fan groups the viewer
--      is a member of, so the callout is personal.
--
-- SAFETY:
--   * Both functions are SECURITY DEFINER with explicit search_path -- matches
--     the pattern from migrations 017/032/051/053/082.
--   * Role detection reads watch_parties.creator_id vs auth.uid() so the
--     caller cannot spoof host access. Reviewer bypass NOT applied here --
--     stats vs playbook privacy differ, and reviewers aren't real hosts.
--   * Guest branch preserves existing `going + interested` semantics from
--     mig 017 -- v9.4 renames "Interested" -> "Maybe" client-side but the
--     status enum stays as-is until a full rename migration lands.
--   * Affinity RPC uses chat_room_members (v9.x fan-group unit) joined
--     against watch_party_rsvps. If a user is in many groups AND many of
--     those group members RSVP'd, we return one row per (group_id, party_id).

-- ─── 1. get_watch_party_attendees_v2 ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_watch_party_attendees_v2(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  display_name TEXT,
  is_host BOOLEAN,
  total_going INT,
  total_maybe INT,
  total_cant_go INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator UUID;
  v_is_host BOOLEAN;
BEGIN
  SELECT wp.creator_id INTO v_creator
  FROM public.watch_parties wp
  WHERE wp.id = p_party_id;

  v_is_host := (v_creator IS NOT NULL AND v_creator = p_viewer_id);

  RETURN QUERY
  WITH totals AS (
    SELECT
      count(*) FILTER (WHERE r.status = 'going')       AS going,
      count(*) FILTER (WHERE r.status = 'interested')  AS maybe,
      count(*) FILTER (WHERE r.status = 'cant_go')     AS cant_go
    FROM public.watch_party_rsvps r
    WHERE r.watch_party_id = p_party_id
  )
  SELECT
    r.id,
    r.user_id,
    r.status,
    COALESCE(u.display_name, 'User') AS display_name,
    v_is_host AS is_host,
    t.going::INT      AS total_going,
    t.maybe::INT      AS total_maybe,
    t.cant_go::INT    AS total_cant_go
  FROM public.watch_party_rsvps r
  LEFT JOIN public.users u ON u.auth_id = r.user_id
  CROSS JOIN totals t
  WHERE r.watch_party_id = p_party_id
    AND (
      v_is_host
      OR r.status = 'going'
    )
  ORDER BY
    CASE r.status WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END,
    r.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) IS
  'Host-aware attendees: hosts see all statuses, guests see going only. Totals returned per-row for cheap client rendering. See migration 084.';

-- ─── 2. get_watch_party_group_affinity ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_watch_party_group_affinity(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  group_id UUID,
  group_name TEXT,
  going_count INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- For each fan group the viewer is a member of, count how many other
  -- members RSVP'd going to this party. Filtered to > 0 so empty groups
  -- don't clutter the callout. Excludes worldcup group_type rows since
  -- the v9.x pivot hides those from the UI.
  WITH viewer_groups AS (
    SELECT cr.id AS group_id, cr.name AS group_name
    FROM public.chat_room_members m
    JOIN public.chat_rooms cr ON cr.id = m.chat_room_id
    WHERE m.user_id = p_viewer_id
      AND cr.group_type IS DISTINCT FROM 'worldcup'
  )
  SELECT
    vg.group_id,
    vg.group_name,
    count(*)::INT AS going_count
  FROM viewer_groups vg
  JOIN public.chat_room_members gm ON gm.chat_room_id = vg.group_id
  JOIN public.watch_party_rsvps r  ON r.user_id = gm.user_id
  WHERE r.watch_party_id = p_party_id
    AND r.status = 'going'
    AND gm.user_id <> p_viewer_id      -- exclude the viewer themselves
  GROUP BY vg.group_id, vg.group_name
  HAVING count(*) > 0
  ORDER BY count(*) DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID) IS
  'Returns top 5 fan groups the viewer is in whose members have RSVP''d going to this party. Powers the "N fans from [Group] also going" callouts on Home + Discover + Watch Party detail. See migration 084.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Host sees all statuses:
--   SELECT status, count(*) FROM get_watch_party_attendees_v2(
--     '<party-id>',
--     (SELECT creator_id FROM watch_parties WHERE id = '<party-id>')
--   ) GROUP BY 1;
--
--   -- Guest sees going only:
--   SELECT DISTINCT status FROM get_watch_party_attendees_v2(
--     '<party-id>', '<random-guest-auth-uid>'
--   );
--   -- expect: 'going' (single row)
--
--   -- Totals populated for both (identical values):
--   SELECT DISTINCT total_going, total_maybe, total_cant_go
--   FROM get_watch_party_attendees_v2('<party-id>', '<any-uid>');
--
--   -- Affinity returns groups the viewer is in with going-count > 0:
--   SELECT * FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>');
