-- 103: rate-limit ceilings enforced on the server (P2.7, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Additive; reversal at the bottom.
--
-- Findings (audit of HEAD 7abeaa9): check_rate_limit (mig 099) keys on
-- auth.uid(), but every call to it is made by the client before the
-- write, and every call site fails open on a timeout. Nothing on the
-- server caps message, clip, comment, like, follow, RSVP or party-create
-- writes; a modified client, or a client that simply skips the RPC, is
-- unbounded. None of the SECURITY DEFINER inserters reference the limiter.
--
-- Design: the ceiling lives in BEFORE INSERT triggers on the tables the
-- writes land in, so it covers direct inserts and the RPCs alike
-- (toggle_clip_like -> clip_likes, follow_user -> user_follows,
-- rsvp_to_watch_party -> watch_party_rsvps). The triggers count under
-- their own action keys ('<table>_insert'), separate from the client's
-- advisory pre-check keys, so a message is not double-counted against one
-- 60/min budget. Rejections raise SQLSTATE 42501 (PostgREST -> 403) with
-- a short user-readable message. service_role is exempt.
--
-- Ceilings (per user):
--   messages           60 / 60 s
--   media_clips         5 / 3600 s      (matches clip_post)
--   clip_comments      30 / 60 s
--   clip_likes        120 / 60 s        (toggle = insert; unlikes are deletes)
--   user_follows       60 / 60 s
--   watch_party_rsvps  20 / 86400 s     (matches rsvp)
--   watch_parties      10 / 86400 s
-- Storage: reuses public.rate_limits (mig 018/037/099), whose GC cron
-- keeps one day, which covers the longest window here.

CREATE OR REPLACE FUNCTION public.rate_limit_ceiling(p_action TEXT, OUT max_count INT, OUT window_seconds INT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE p_action
      WHEN 'message_send'            THEN 60
      WHEN 'clip_post'               THEN 5
      WHEN 'moment_post'             THEN 10
      WHEN 'rsvp'                    THEN 20
      WHEN 'messages_insert'         THEN 60
      WHEN 'media_clips_insert'      THEN 5
      WHEN 'clip_comments_insert'    THEN 30
      WHEN 'clip_likes_insert'       THEN 120
      WHEN 'user_follows_insert'     THEN 60
      WHEN 'watch_party_rsvps_insert' THEN 20
      WHEN 'watch_parties_insert'    THEN 10
      ELSE 60
    END,
    CASE p_action
      WHEN 'clip_post'               THEN 3600
      WHEN 'moment_post'             THEN 3600
      WHEN 'rsvp'                    THEN 86400
      WHEN 'media_clips_insert'      THEN 3600
      WHEN 'watch_party_rsvps_insert' THEN 86400
      WHEN 'watch_parties_insert'    THEN 86400
      ELSE 60
    END;
$$;

-- Internal: count-and-record for a given user; TRUE when allowed. Not
-- exposed to any role (no GRANT); called only from the trigger below.
CREATE OR REPLACE FUNCTION public.rate_limit_consume(p_user_id UUID, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max    INT;
  v_window INT;
  v_count  INT;
BEGIN
  SELECT max_count, window_seconds INTO v_max, v_window FROM public.rate_limit_ceiling(p_action);
  SELECT COALESCE(SUM(count), 0) INTO v_count
  FROM public.rate_limits
  WHERE user_id = p_user_id
    AND action = p_action
    AND window_start >= now() - (v_window || ' seconds')::interval;
  IF v_count >= v_max THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.rate_limits (user_id, action) VALUES (p_user_id, p_action);
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_consume(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Trigger body: the action key is '<table>_insert'; the user column is
-- given as the trigger argument because the tables name it differently.
CREATE OR REPLACE FUNCTION public.enforce_insert_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role    TEXT;
  v_col     TEXT := TG_ARGV[0];
  v_user    UUID;
  v_action  TEXT := TG_TABLE_NAME || '_insert';
  v_row     JSONB;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_row := to_jsonb(NEW);
  v_user := (v_row ->> v_col)::uuid;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.rate_limit_consume(v_user, v_action) THEN
    RAISE EXCEPTION 'You are doing that too often. Please wait a moment and try again.'
      USING ERRCODE = '42501', HINT = 'rate_limited:' || v_action;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_limit_messages ON public.messages;
CREATE TRIGGER trg_rate_limit_messages
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_media_clips ON public.media_clips;
CREATE TRIGGER trg_rate_limit_media_clips
  BEFORE INSERT ON public.media_clips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_clip_comments ON public.clip_comments;
CREATE TRIGGER trg_rate_limit_clip_comments
  BEFORE INSERT ON public.clip_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_clip_likes ON public.clip_likes;
CREATE TRIGGER trg_rate_limit_clip_likes
  BEFORE INSERT ON public.clip_likes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_user_follows ON public.user_follows;
CREATE TRIGGER trg_rate_limit_user_follows
  BEFORE INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('follower_id');

DROP TRIGGER IF EXISTS trg_rate_limit_watch_party_rsvps ON public.watch_party_rsvps;
CREATE TRIGGER trg_rate_limit_watch_party_rsvps
  BEFORE INSERT ON public.watch_party_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('user_id');

DROP TRIGGER IF EXISTS trg_rate_limit_watch_parties ON public.watch_parties;
CREATE TRIGGER trg_rate_limit_watch_parties
  BEFORE INSERT ON public.watch_parties
  FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_rate_limit('creator_id');

-- PRE-CHECK before applying: confirm the user column names above exist:
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name IN ('messages','media_clips','clip_comments','clip_likes','user_follows','watch_party_rsvps','watch_parties')
--     AND column_name IN ('user_id','follower_id','creator_id');
--
-- Reversal: DROP the seven triggers, then
--   DROP FUNCTION IF EXISTS public.enforce_insert_rate_limit();
--   DROP FUNCTION IF EXISTS public.rate_limit_consume(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.rate_limit_ceiling(TEXT);
