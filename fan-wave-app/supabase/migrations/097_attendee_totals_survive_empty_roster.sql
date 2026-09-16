-- 097: the totals disappeared with the roster.
--
-- WHY:
--   Reported from iOS UAT 2026-09-09 (BUG-14). A host created a PUBLIC
--   watch party (auto-RSVP 'going', detail read "1/50"), tapped Maybe, and
--   the detail screen then said:
--
--       "0 going . 0 maybe"      and      "No attendees yet"
--
--   while watch_party_rsvps held exactly one row for that party, the host's,
--   status 'interested'. The totals were not stale. They were fabricated.
--
--   get_watch_party_attendees_v2 computes the three totals in a CTE and
--   attaches them to every returned row via CROSS JOIN. That works only for
--   as long as at least one row survives the visibility filter. Migration
--   089 narrowed that filter:
--
--       v_full_roster := v_is_host AND v_visibility = 'private';
--       ...
--       WHERE r.watch_party_id = p_party_id
--         AND (v_full_roster OR r.status = 'going')
--
--   For a PUBLIC party the host now sees only 'going' rows. Our host had no
--   'going' row -- they had just switched to Maybe -- so the query returned
--   ZERO rows, the totals had nothing to ride on, and the client's
--   `data.length === 0` branch reset all three counters to 0.
--
--   Migration 089's own comment states the opposite intent:
--
--       "Totals stay available to everyone either way, so a public host
--        never loses the number they came for."
--
--   The intent was right and the transport defeated it. Row visibility and
--   aggregate visibility are different questions, and coupling them through
--   CROSS JOIN silently answered the second with the first.
--
-- WHAT:
--   Drive the query from the totals CTE and LEFT JOIN the roster onto it.
--   Exactly one row always comes back even when nothing is visible; in that
--   case its attendee columns are NULL and the totals are still correct.
--
--   Client contract change: a row with a NULL id is a totals-only row and
--   carries no attendee. app/watch-party/[id].tsx filters those out of the
--   list while still reading totals from data[0].
--
-- SAFETY:
--   * No visibility change. A public party's guest list is exactly as
--     private as migration 089 made it -- non-'going' rows are still
--     withheld from everyone but a private-party host.
--   * Aggregates were already public: the pre-089 function returned them to
--     any caller, and the party's own rsvp_count column is world-readable.
--     Nothing is disclosed here that was not disclosed before.
--   * Signature and column list are unchanged, so no client breaks.

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
  v_creator    UUID;
  v_visibility TEXT;
  v_is_host    BOOLEAN;
  v_full_roster BOOLEAN;
BEGIN
  SELECT wp.creator_id, wp.visibility
    INTO v_creator, v_visibility
  FROM public.watch_parties wp
  WHERE wp.id = p_party_id;

  v_is_host := (v_creator IS NOT NULL AND v_creator = p_viewer_id);

  -- Unchanged from migration 089: the full roster is a private-party
  -- benefit. This migration only decouples the counts from it.
  v_full_roster := v_is_host AND v_visibility = 'private';

  RETURN QUERY
  WITH totals AS (
    SELECT
      count(*) FILTER (WHERE r.status = 'going')       AS going,
      count(*) FILTER (WHERE r.status = 'interested')  AS maybe,
      count(*) FILTER (WHERE r.status = 'cant_go')     AS cant_go
    FROM public.watch_party_rsvps r
    WHERE r.watch_party_id = p_party_id
  ),
  visible AS (
    SELECT
      r.id,
      r.user_id,
      r.status,
      COALESCE(u.display_name, 'User') AS display_name,
      r.created_at
    FROM public.watch_party_rsvps r
    LEFT JOIN public.users u ON u.auth_id = r.user_id
    WHERE r.watch_party_id = p_party_id
      AND (v_full_roster OR r.status = 'going')
  )
  -- totals LEFT JOIN visible, not the other way round: the aggregate row
  -- exists whether or not anybody is visible.
  SELECT
    v.id,
    v.user_id,
    v.status,
    v.display_name,
    v_is_host AS is_host,
    t.going::INT   AS total_going,
    t.maybe::INT   AS total_maybe,
    t.cant_go::INT AS total_cant_go
  FROM totals t
  LEFT JOIN visible v ON TRUE
  ORDER BY
    CASE v.status WHEN 'going' THEN 0 WHEN 'interested' THEN 1 ELSE 2 END,
    v.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_attendees_v2(UUID, UUID) IS
  'Host-aware attendees. Full roster for private-party hosts (mig 089); everyone else sees going only. Totals are computed independently of roster visibility and are returned even when no attendee row is visible -- in that case a single row with a NULL id carries them (mig 097). See migrations 084, 089, 097.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The BUG-14 party: public, one 'interested' row, viewed by its host.
--   -- Before 097 this returned 0 rows; now it returns one totals row.
--   SELECT id, status, total_going, total_maybe, total_cant_go
--   FROM get_watch_party_attendees_v2(
--     'e9368715-a4e5-4284-abfc-a360e85eedfa',
--     '00a024e1-be86-40f7-b1d7-61df24f6100a');
--   -- expect: 1 row, id NULL, total_maybe = 1
--
--   -- A private-party host still gets every row:
--   -- expect: one row per RSVP, id NOT NULL
--
--   -- A stranger on a public party still sees only 'going':
--   -- expect: going rows only, plus correct totals
