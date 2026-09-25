-- 102: clip quota enforced on the server (P2.8, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Additive; reversal at the bottom.
--
-- Findings (audit of HEAD 7abeaa9):
--   * check_clip_quota(uid) trusted the caller-supplied uid, so a modified
--     client could ask for someone else's quota (or skip the call).
--   * The quota was advisory only: media_clips_insert RLS checks
--     user_id = auth.uid() and nothing else (mig 070). A client that skips
--     the RPC inserts freely.
--   * media_clips.media_url had no UNIQUE, so an insert whose response was
--     lost followed by a retry produced two rows for one blob.
--
-- Changes:
--   1. check_clip_quota: when a JWT is present, the identity is
--      auth.uid(); the argument is honoured only for service_role callers
--      (no JWT uid), so admin tooling keeps working.
--   2. BEFORE INSERT trigger on media_clips: free-tier writers (tier rank
--      below home_team) are limited to 3 clips per rolling 24 h, counted
--      exactly as check_clip_quota counts. service_role is exempt. A
--      per-user advisory transaction lock closes the concurrent-insert
--      race. Rejected inserts raise SQLSTATE 42501 (PostgREST -> 403)
--      with a message the client shows verbatim.
--   3. UNIQUE INDEX on media_clips(media_url). PRE-CHECK before applying:
--        SELECT media_url, count(*) FROM public.media_clips
--        WHERE media_url IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--      must return zero rows. (Prod had 6 live clips at the last audit.)
--
-- Client compatibility: lib/clipUploads.ts (v9.5.23) already reconciles a
-- 23505 duplicate by media_url as success; create-clip.tsx keeps calling
-- check_clip_quota for the pre-flight message. The trigger is the ceiling.

-- 1. Identity from the JWT -------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_clip_quota(uid UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_tier      TEXT;
  v_cap       INT := 3;
  v_used      INT;
  v_oldest    TIMESTAMPTZ;
  v_resets_at TIMESTAMPTZ;
  v_public_users_id UUID;
BEGIN
  -- A signed-in caller can only ask about themselves. Without a JWT
  -- (service_role / SQL editor) the argument is used as before.
  v_uid := COALESCE(auth.uid(), uid);
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'remaining', 0, 'cap', v_cap, 'resets_at', NULL, 'tier', NULL);
  END IF;

  v_tier := public.get_user_tier(v_uid);

  IF public.tier_rank(v_tier) >= public.tier_rank('home_team') THEN
    RETURN jsonb_build_object(
      'allowed',   true,
      'remaining', 9999,
      'cap',       9999,
      'resets_at', NULL,
      'tier',      v_tier
    );
  END IF;

  SELECT id INTO v_public_users_id FROM public.users WHERE auth_id = v_uid;

  SELECT count(*), min(created_at)
  INTO v_used, v_oldest
  FROM public.media_clips
  WHERE created_at > now() - interval '24 hours'
    AND (
      user_id = v_uid
      OR (v_public_users_id IS NOT NULL AND user_id = v_public_users_id)
    );

  IF v_oldest IS NOT NULL THEN
    v_resets_at := v_oldest + interval '24 hours';
  END IF;

  RETURN jsonb_build_object(
    'allowed',   v_used < v_cap,
    'remaining', GREATEST(v_cap - v_used, 0),
    'cap',       v_cap,
    'resets_at', v_resets_at,
    'tier',      v_tier
  );
END;
$$;

COMMENT ON FUNCTION public.check_clip_quota(UUID) IS
  'Clip quota for the caller. Identity is auth.uid() when a JWT is present; the argument is honoured only for service_role. Free: 3 per rolling 24h. Home Team+: unlimited. Enforced by trg_media_clips_quota (mig 102).';

-- 2. Server-side ceiling ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_clip_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_tier  TEXT;
  v_used  INT;
  v_public_users_id UUID;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_tier := public.get_user_tier(NEW.user_id);
  IF public.tier_rank(v_tier) >= public.tier_rank('home_team') THEN
    RETURN NEW;
  END IF;

  -- Serialise concurrent inserts by the same user so two in-flight posts
  -- cannot both see "2 used" and both pass.
  PERFORM pg_advisory_xact_lock(hashtext('clip_quota:' || NEW.user_id::text));

  SELECT id INTO v_public_users_id FROM public.users WHERE auth_id = NEW.user_id;

  SELECT count(*) INTO v_used
  FROM public.media_clips
  WHERE created_at > now() - interval '24 hours'
    AND (
      user_id = NEW.user_id
      OR (v_public_users_id IS NOT NULL AND user_id = v_public_users_id)
    );

  IF v_used >= 3 THEN
    RAISE EXCEPTION 'Free tier allows 3 clips per 24 hours. Upgrade to Home Team for unlimited clips.'
      USING ERRCODE = '42501', HINT = 'clip_quota_exceeded';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_media_clips_quota ON public.media_clips;
CREATE TRIGGER trg_media_clips_quota
  BEFORE INSERT ON public.media_clips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_clip_quota();

-- 3. One row per blob -------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS media_clips_media_url_key
  ON public.media_clips (media_url);

-- Reversal:
--   DROP TRIGGER IF EXISTS trg_media_clips_quota ON public.media_clips;
--   DROP FUNCTION IF EXISTS public.enforce_clip_quota();
--   DROP INDEX IF EXISTS public.media_clips_media_url_key;
--   -- and re-run migration 095 to restore the previous check_clip_quota body.
