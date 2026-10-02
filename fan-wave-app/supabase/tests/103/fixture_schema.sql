-- Fixture for supabase/tests/103: the smallest schema on which the REAL
-- migrations 099, 102 and 103 (and the real 073 RSVP RPC) apply unchanged.
--
-- What is real here, copied verbatim from the migration that owns it:
--   tier_rank, get_user_tier, has_tier_or_higher     (082)
--   is_reviewer_account                              (053)
--   rate_limits table + RLS policy                   (037)
--   toggle_clip_like                                 (080)
--   follow_user                                      (011)
-- What is stubbed: auth.uid() (same expression Supabase ships), the
-- Supabase roles, auth.users, cron.job / cron.alter_job, has_wc_access,
-- and the content tables trimmed to the columns the code under test
-- touches (unique keys and NOT NULLs preserved).

-- ─── Roles ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN; END IF;
END $$;

-- ─── auth schema ───────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY,
  email TEXT
);

-- Same expression as Supabase's auth.uid().
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ─── cron stub (099 alters the gc job through cron.alter_job) ──────────
CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE IF NOT EXISTS cron.job (
  jobid    BIGSERIAL PRIMARY KEY,
  jobname  TEXT,
  schedule TEXT,
  command  TEXT
);

CREATE OR REPLACE FUNCTION cron.alter_job(job_id BIGINT, command TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE cron.job SET command = COALESCE(alter_job.command, job.command) WHERE jobid = job_id;
$$;

INSERT INTO cron.job (jobname, schedule, command)
SELECT 'gc-rate-limits', '*/2 * * * *',
       $cmd$DELETE FROM public.rate_limits WHERE window_start < now() - interval '5 minutes'$cmd$
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gc-rate-limits');

-- ─── public tables (trimmed) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id           UUID UNIQUE,
  display_name      TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'home_team', 'mvp', 'business'))
);

CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.media_clips (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID REFERENCES public.chat_rooms(id),
  user_id      UUID NOT NULL,
  title        TEXT NOT NULL,
  media_url    TEXT NOT NULL,
  media_type   TEXT NOT NULL DEFAULT 'video',
  like_count   INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id    UUID NOT NULL REFERENCES public.media_clips(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id    UUID NOT NULL REFERENCES public.media_clips(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (clip_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.user_follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID NOT NULL,
  following_id UUID NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id != following_id)
);

CREATE TABLE IF NOT EXISTS public.watch_parties (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL,
  event_id   UUID,
  title      TEXT NOT NULL,
  venue_name TEXT NOT NULL DEFAULT 'Test venue',
  capacity   INT DEFAULT 50,
  rsvp_count INT DEFAULT 0,
  visibility TEXT DEFAULT 'public',
  starts_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 day',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.watch_party_rsvps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_party_id UUID NOT NULL REFERENCES public.watch_parties(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  status         TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'declined')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (watch_party_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.match_moments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_room_id UUID REFERENCES public.chat_rooms(id),
  user_id      UUID NOT NULL,
  moment_type  TEXT NOT NULL,
  comment      TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- rate_limits exactly as 037 created it (RLS on, service-role SELECT only).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  action       TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count        INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits (user_id, action, window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'rate_limits_service_select' AND tablename = 'rate_limits') THEN
    CREATE POLICY rate_limits_service_select ON public.rate_limits FOR SELECT
      USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
  END IF;
END $$;

-- ─── Tier helpers, verbatim from 082 / 053 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tier_rank(t TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE t
    WHEN 'free'      THEN 0
    WHEN 'home_team' THEN 1
    WHEN 'mvp'       THEN 2
    WHEN 'business'  THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_reviewer_account(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = uid
      AND lower(email) IN (
        'fansphere.reviewer@gmail.com',
        'reviewer@fansphere.org'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_tier(uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_reviewer_account(uid) THEN 'mvp'
    ELSE COALESCE(
      (SELECT u.subscription_tier FROM public.users u WHERE u.auth_id = uid),
      'free'
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_tier_or_higher(uid UUID, min_tier TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_reviewer_account(uid)
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = uid
          AND public.tier_rank(u.subscription_tier) >= public.tier_rank(min_tier)
      );
$$;

-- 073's RPC gates WC parties on this; no WC parties in the fixture.
CREATE OR REPLACE FUNCTION public.has_wc_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$ SELECT TRUE; $$;

-- ─── RPCs that upsert into limited tables, verbatim ────────────────────
-- toggle_clip_like (080)
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
    DELETE FROM public.clip_likes WHERE id = v_existing_id;
    RETURN false;
  ELSE
    INSERT INTO public.clip_likes (clip_id, user_id)
    VALUES (p_clip_id, v_uid)
    ON CONFLICT (clip_id, user_id) DO NOTHING;
    RETURN true;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.toggle_clip_like(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.toggle_clip_like(UUID) TO authenticated;

-- follow_user (011)
CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_following_id = auth.uid() THEN
        RAISE EXCEPTION 'cannot follow yourself';
    END IF;

    INSERT INTO user_follows (follower_id, following_id)
    VALUES (auth.uid(), p_following_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;
END;
$$;

-- ─── Grants so the tests can run as the Supabase roles ─────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT INSERT ON public.messages TO anon;  -- so an anon-role write can be shown to be limited
