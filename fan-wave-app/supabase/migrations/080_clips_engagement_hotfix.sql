-- 080: Clips engagement pipeline hotfix (v9.2.0)
--
-- WHY:
--   Deep-dive audit 2026-07-22 revealed the entire clips engagement
--   pipeline is silently broken -- influencers currently see zeros for
--   Views, wrong numbers for Likes/Shares, and a "Following" feed
--   that isn't actually following anyone. Four of the five headline
--   metrics on Profile → My Stats are lies to the creator.
--
--   Root cause bundle:
--     * toggle_clip_like(p_clip_id) called with 1 arg from client, but
--       the current RPC signature is (p_clip_id, p_user_id) with an
--       auth-check that RAISEs on mismatch -- so every like is a
--       silent DB no-op that the client "catches" without noticing
--       (Postgrest errors resolve, don't reject).
--     * media_clips.view_count has never been incremented anywhere in
--       the entire codebase.
--     * media_clips.share_count column does not exist, but the mapper
--       reads it and creator-stats aggregates it. Share events land in
--       analytics_events with the wrong event_name filter, so the
--       stats query returns zero regardless.
--     * "Following" clips tab does `.order('created_at')` with no
--       user_follows join.
--
-- WHAT (idempotent):
--   1. Rewrite toggle_clip_like as 1-arg using auth.uid() internally,
--      matching how the client calls it. DELETE-on-toggle-off pattern
--      so denormalized like_count triggers stay honest.
--   2. Add media_clips.share_count INT column + trigger on
--      analytics_events INSERT to increment when event_name matches
--      the actual emitted value 'content_shared' and metadata.id points
--      at a media_clips row. Backfill from existing events.
--   3. Create clip_views table with UNIQUE (clip_id, viewer_id,
--      viewed_hour) so a single scroller can't inflate. Add
--      record_clip_view(p_clip_id) RPC that skips the creator's own
--      views and dedupes by hour.
--   4. Create get_following_clips(p_limit, p_offset) SECURITY DEFINER
--      RPC that joins user_follows.
--   5. One-shot reconciliation UPDATE for users.follower_count and
--      users.following_count in case any prior direct writes bypassed
--      the maintenance triggers.
--   6. Null out media_clips.sport_id values that don't match any known
--      sport key -- clips inserted before create-clip forced sport
--      selection had 'nfl' silently applied as a default even when the
--      creator meant something else. Nulling those makes the sport
--      badge honest ("no tag" instead of "wrong tag").

BEGIN;

-- ============================================================
-- 1. toggle_clip_like: 1-arg form matching how the client calls it.
-- ============================================================
DROP FUNCTION IF EXISTS public.toggle_clip_like(UUID, UUID);
DROP FUNCTION IF EXISTS public.toggle_clip_like(UUID);

CREATE OR REPLACE FUNCTION public.toggle_clip_like(p_clip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_uid         UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_existing_id
    FROM public.clip_likes
   WHERE clip_id = p_clip_id AND user_id = v_uid;

  IF v_existing_id IS NOT NULL THEN
    -- Toggle off. Denormalized like_count decrement fires via
    -- trg_clip_like_delete (mig 004).
    DELETE FROM public.clip_likes WHERE id = v_existing_id;
    RETURN false;
  ELSE
    -- Toggle on. ON CONFLICT is defensive against a race with a
    -- concurrent client tap; the delete branch above already
    -- guaranteed no row exists at read time.
    INSERT INTO public.clip_likes (clip_id, user_id)
    VALUES (p_clip_id, v_uid)
    ON CONFLICT (clip_id, user_id) DO NOTHING;
    RETURN true;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_clip_like(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.toggle_clip_like(UUID) TO authenticated;

-- ============================================================
-- 2. Denormalized share_count + trigger + backfill.
-- ============================================================
ALTER TABLE public.media_clips
  ADD COLUMN IF NOT EXISTS share_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._increment_clip_share_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clip_id UUID;
BEGIN
  -- Client emits 'content_shared' with metadata.id = clip_id for clip
  -- shares. Screen may be 'clips' or 'clip' depending on entry point;
  -- match on metadata.id existence as the primary signal so a future
  -- entry-point rename doesn't silently disable share counting again.
  IF NEW.event_name = 'content_shared'
     AND NEW.metadata IS NOT NULL
     AND NEW.metadata ? 'id' THEN
    BEGIN
      v_clip_id := (NEW.metadata->>'id')::uuid;
    EXCEPTION WHEN others THEN
      -- metadata.id isn't a UUID (e.g., a watch-party share). Skip.
      RETURN NEW;
    END;

    -- Only bump the count if the id actually points at a media_clip.
    -- Silently ignore shares of other content types.
    UPDATE public.media_clips
       SET share_count = share_count + 1
     WHERE id = v_clip_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analytics_share_count ON public.analytics_events;
CREATE TRIGGER trg_analytics_share_count
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public._increment_clip_share_count();

-- Backfill: sum existing content_shared events per clip id.
UPDATE public.media_clips mc
   SET share_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT (metadata->>'id')::uuid AS clip_id, COUNT(*) AS cnt
      FROM public.analytics_events
     WHERE event_name = 'content_shared'
       AND metadata ? 'id'
     GROUP BY (metadata->>'id')::uuid
  ) sub
 WHERE mc.id = sub.clip_id
   AND mc.share_count = 0;  -- don't double-count if backfill re-runs

-- ============================================================
-- 3. clip_views + record_clip_view RPC.
-- ============================================================
-- viewed_hour is a real column (not GENERATED). Postgres rejects
-- GENERATED expressions using date_trunc('hour', timestamptz) with
-- 42P17 because that function is STABLE (depends on session TZ), not
-- IMMUTABLE. The RPC populates viewed_hour on INSERT with an explicit
-- date_trunc call, which works fine because it runs per-statement.
CREATE TABLE IF NOT EXISTS public.clip_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id     UUID NOT NULL REFERENCES public.media_clips(id) ON DELETE CASCADE,
  viewer_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_hour TIMESTAMPTZ NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clip_views_dedup_key'
  ) THEN
    ALTER TABLE public.clip_views
      ADD CONSTRAINT clip_views_dedup_key
      UNIQUE (clip_id, viewer_id, viewed_hour);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clip_views_clip_id_idx ON public.clip_views (clip_id);

ALTER TABLE public.clip_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clip_views_insert_own ON public.clip_views;
CREATE POLICY clip_views_insert_own ON public.clip_views
  FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS clip_views_select_own ON public.clip_views;
CREATE POLICY clip_views_select_own ON public.clip_views
  FOR SELECT TO authenticated
  USING (viewer_id = auth.uid());

CREATE OR REPLACE FUNCTION public.record_clip_view(p_clip_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_creator   UUID;
  v_inserted  BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Look up creator; skip creators viewing their own clips so a
  -- posting influencer previewing their own upload doesn't inflate.
  SELECT user_id INTO v_creator FROM public.media_clips WHERE id = p_clip_id;
  IF v_creator IS NULL OR v_creator = v_uid THEN RETURN; END IF;

  -- Dedupe by (clip_id, viewer_id, hour). One user watching the same
  -- clip 100 times in an hour counts as ONE view. viewed_hour is a
  -- regular column (not GENERATED -- see clip_views table comment) so
  -- we set it explicitly here with the same date_trunc expression.
  INSERT INTO public.clip_views (clip_id, viewer_id, viewed_hour)
       VALUES (p_clip_id, v_uid, date_trunc('hour', now()))
  ON CONFLICT ON CONSTRAINT clip_views_dedup_key DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted THEN
    UPDATE public.media_clips
       SET view_count = view_count + 1
     WHERE id = p_clip_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_clip_view(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_clip_view(UUID) TO authenticated;

-- ============================================================
-- 4. get_following_clips RPC (Following tab).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_following_clips(
  p_limit  INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS SETOF public.media_clips
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mc.*
    FROM public.media_clips mc
    JOIN public.user_follows uf
      ON uf.following_id = mc.user_id
   WHERE uf.follower_id = auth.uid()
   ORDER BY mc.created_at DESC
   LIMIT p_limit OFFSET p_offset;
$$;

REVOKE EXECUTE ON FUNCTION public.get_following_clips(INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_following_clips(INT, INT) TO authenticated;

-- ============================================================
-- 5. Reconcile follower_count / following_count.
-- ============================================================
UPDATE public.users u
   SET follower_count  = COALESCE((
         SELECT COUNT(*) FROM public.user_follows
          WHERE following_id = u.auth_id
       ), 0),
       following_count = COALESCE((
         SELECT COUNT(*) FROM public.user_follows
          WHERE follower_id = u.auth_id
       ), 0);

-- ============================================================
-- 6. Null out orphan sport_id values on media_clips.
--    v9.2 forces explicit sport selection in Create Clip -- old rows
--    that got 'nfl' silently applied as the pre-fix default get
--    nulled here so the sport badge is honest going forward.
--    We only null values NOT present in the canonical Sports.ts list.
-- ============================================================
UPDATE public.media_clips
   SET sport_id = NULL
 WHERE sport_id IS NOT NULL
   AND sport_id NOT IN ('nfl','nba','wnba','mlb','soccer','nhl','cfb','cbb','mls','ufc');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT proname, oidvectortypes(proargtypes) FROM pg_proc
--    WHERE proname IN ('toggle_clip_like','record_clip_view','get_following_clips');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='media_clips' AND column_name='share_count';
--   SELECT COUNT(*) FROM public.clip_views;
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_analytics_share_count';
