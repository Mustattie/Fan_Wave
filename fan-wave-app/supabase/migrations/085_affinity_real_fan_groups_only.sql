-- 085: Fan-group affinity counts only real fan groups, and reports the
--      number of DISTINCT fans rather than a per-room tally.
--
-- v9.4.3 UAT Round 4.
--
-- WHY (UAT screenshot, Watch Party detail):
--   A party with exactly ONE going RSVP rendered five separate callouts --
--   "🎉 1 fan from Chicago White Sox vs New York Yankees also going",
--   "🎉 1 fan from New York Yankees vs Atlanta Braves also going", ... --
--   under a header that correctly read "1/50 going · 0 maybe · 0 can't go".
--   Reads as six people. It is one person, counted once per chat room the
--   viewer happens to share with them.
--
--   Two causes, both fixed here:
--
--   1. Migration 084 filtered viewer rooms with only
--        cr.group_type IS DISTINCT FROM 'worldcup'
--      which lets group_type='game_chat' rooms through. Those are the
--      per-game live chat rooms from migration 067, and
--      get_or_create_game_chat auto-joins the caller -- so merely opening a
--      game's Live Chat enrolls you in a "group". Four of the five callouts
--      in the screenshot were game rooms; only one was a real fan group.
--
--      Fixed with an allow-list -- group_type IN ('sports','general') --
--      instead of a deny-list, so a future room type can't leak in the same
--      way. 'sports' is what create-group.tsx writes for every user-made fan
--      group; 'general' is the legacy value from migration 002.
--
--   2. The rows are inherently per-group, so one fan who shares two REAL
--      groups with the viewer still yields two rows. Adding distinct_fans
--      (the same value on every row, like 084's totals) lets the client
--      render one honest headline instead of stacking rows that read as a
--      sum.
--
-- SAFETY:
--   * DROP + CREATE, not CREATE OR REPLACE: the return type gains a column
--     and Postgres refuses to replace a function whose OUT columns changed.
--     The DROP is IF EXISTS and the signature is unchanged, so grants are
--     re-issued below and PostgREST is told to reload.
--   * Still SECURITY DEFINER + explicit search_path, matching 084.
--   * Viewer remains excluded from the counts (gm.user_id <> p_viewer_id).
--   * Purely a read path -- no data is rewritten by this migration.

DROP FUNCTION IF EXISTS public.get_watch_party_group_affinity(UUID, UUID);

CREATE FUNCTION public.get_watch_party_group_affinity(
  p_party_id UUID,
  p_viewer_id UUID
)
RETURNS TABLE (
  group_id UUID,
  group_name TEXT,
  going_count INT,
  distinct_fans INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Real fan groups the viewer belongs to. Allow-list on group_type keeps
  -- game_chat (mig 067) and worldcup (mig 006) rooms out.
  WITH viewer_groups AS (
    SELECT cr.id AS group_id, cr.name AS group_name
    FROM public.chat_room_members m
    JOIN public.chat_rooms cr ON cr.id = m.chat_room_id
    WHERE m.user_id = p_viewer_id
      AND cr.group_type IN ('sports', 'general')
  ),
  -- (group, fan) pairs: members of those groups who RSVP'd going, viewer
  -- excluded. DISTINCT so a user who somehow holds two membership rows in
  -- one room is not double counted.
  going_members AS (
    SELECT DISTINCT vg.group_id, vg.group_name, gm.user_id
    FROM viewer_groups vg
    JOIN public.chat_room_members gm ON gm.chat_room_id = vg.group_id
    JOIN public.watch_party_rsvps r  ON r.user_id = gm.user_id
    WHERE r.watch_party_id = p_party_id
      AND r.status = 'going'
      AND gm.user_id <> p_viewer_id
  ),
  -- How many real humans that is across ALL the viewer's groups. One fan
  -- in three shared groups counts once here, three times in going_count.
  overall AS (
    SELECT count(DISTINCT user_id)::INT AS distinct_fans FROM going_members
  )
  SELECT
    gm.group_id,
    gm.group_name,
    count(*)::INT AS going_count,
    o.distinct_fans
  FROM going_members gm
  CROSS JOIN overall o
  GROUP BY gm.group_id, gm.group_name, o.distinct_fans
  ORDER BY count(*) DESC, gm.group_name
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_watch_party_group_affinity(UUID, UUID) IS
  'Top 5 REAL fan groups (group_type sports/general -- never game_chat or worldcup) the viewer is in whose members RSVP''d going to this party, plus distinct_fans: the number of unique people that represents across all of them. See migration 085.';

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The screenshot case: one going RSVP, viewer sharing several game
--   -- chat rooms with them. Expect at most the real fan groups, and
--   -- distinct_fans = 1 on every row.
--   SELECT * FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>');
--
--   -- No game rooms may appear:
--   SELECT cr.group_type
--     FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>') a
--     JOIN chat_rooms cr ON cr.id = a.group_id;
--   -- expect: only 'sports' / 'general'
--
--   -- distinct_fans never exceeds the party's going total:
--   SELECT DISTINCT a.distinct_fans, t.total_going
--     FROM get_watch_party_group_affinity('<party-id>', '<viewer-uid>') a,
--          LATERAL (SELECT total_going FROM get_watch_party_attendees_v2(
--                     '<party-id>', '<viewer-uid>') LIMIT 1) t;
