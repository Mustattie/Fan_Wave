-- 081: get_creator_stats aggregates engagement in a time window (v9.2.2)
--
-- WHY:
--   v9.2.0 UAT 2026-07-23: reviewer posted 3 clips ~34 days ago. Mustattie
--   liked all 3 today. Reviewer opened Profile → My Stats → "7 Days"
--   tab and saw all zeros -- even though 6 like events (Whoaa + Goooaaal
--   + Goal x2 each) landed within the last 7 days.
--
--   Root cause: creator-stats.tsx filters media_clips WHERE
--   created_at >= <cutoff>. That is "posts I made in the window," NOT
--   "engagement I received in the window." Consequence: a clip posted
--   40 days ago that gets 1000 likes today shows 0 likes on the 7-day
--   or 30-day view. Wrong semantic for an influencer dashboard --
--   creators track growth over time on their viral evergreen content,
--   not just posts from the last week.
--
-- WHAT (idempotent):
--   Create get_creator_stats(p_since timestamptz) SECURITY DEFINER RPC
--   that scopes counts to engagement timestamps (clip_views.viewed_at,
--   clip_likes.created_at, analytics_events.created_at with metadata.id
--   matching a media_clip owned by the caller).
--
--   Followers is a lifetime count from users.follower_count -- there is
--   no per-follow timestamp on user_follows.created_at that would let
--   us window follower growth; that's a follow-up ticket if we need it.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_creator_stats(
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  total_views  BIGINT,
  total_likes  BIGINT,
  total_shares BIGINT,
  followers    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_followers INT;
BEGIN
  IF v_uid IS NULL THEN
    -- Unauthenticated caller. Return zeros rather than raising so the
    -- UI doesn't crash on a race between sign-in and the stats fetch.
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::int;
    RETURN;
  END IF;

  SELECT COALESCE(follower_count, 0)
    INTO v_followers
    FROM public.users
   WHERE auth_id = v_uid;

  RETURN QUERY
  WITH my_clips AS (
    SELECT id FROM public.media_clips WHERE user_id = v_uid
  )
  SELECT
    -- Views received in the window on the caller's own clips.
    COALESCE((
      SELECT COUNT(*)
        FROM public.clip_views cv
       WHERE cv.clip_id IN (SELECT id FROM my_clips)
         AND cv.viewed_at >= p_since
    ), 0)::bigint,

    -- Likes received in the window on the caller's own clips.
    COALESCE((
      SELECT COUNT(*)
        FROM public.clip_likes cl
       WHERE cl.clip_id IN (SELECT id FROM my_clips)
         AND cl.created_at >= p_since
    ), 0)::bigint,

    -- Shares OF the caller's clips in the window. analytics_events
    -- stores clip_id in metadata->>'id' for content_shared events.
    -- Regex-guard the value before casting to UUID -- a share event
    -- for a non-UUID target (unlikely but possible for future content
    -- types) is silently excluded rather than raising 22P02.
    COALESCE((
      SELECT COUNT(*)
        FROM public.analytics_events ae
       WHERE ae.event_name = 'content_shared'
         AND ae.metadata ? 'id'
         AND ae.created_at >= p_since
         AND (ae.metadata->>'id') ~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND (ae.metadata->>'id')::uuid IN (SELECT id FROM my_clips)
    ), 0)::bigint,

    COALESCE(v_followers, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_creator_stats(TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_creator_stats(TIMESTAMPTZ) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   -- All-time (should equal lifetime totals)
--   SELECT * FROM public.get_creator_stats('1970-01-01'::timestamptz);
--   -- Last 7 days (should equal engagement received in the window,
--   -- regardless of when the underlying clip was posted)
--   SELECT * FROM public.get_creator_stats(now() - INTERVAL '7 days');
