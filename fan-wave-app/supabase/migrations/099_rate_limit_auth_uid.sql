-- 099: check_rate_limit() derives the user from auth.uid().
--
-- Phase 1 of the 2026-09-16 production scalability review.
--
-- What was wrong (migration 037, unchanged since):
--
--   1. The function trusted its p_user_id argument. It never compared it to
--      auth.uid(), so any caller could pass a random UUID per request and
--      the limiter -- the only brake on chat spam during a live game --
--      counted against a user who does not exist. p_max_count and
--      p_window_seconds were also caller-supplied, so a client could simply
--      ask for a limit of a million.
--
--   2. EXECUTE was granted to anon. The limiter is only meaningful for a
--      signed-in user; anon has no identity to limit.
--
--   3. The GC that keeps rate_limits small deleted rows older than 5
--      minutes (both the in-function probabilistic delete and the
--      gc-rate-limits cron from migration 052). Three of the five actions
--      use windows longer than that -- clip_post 1 h, moment_post 1 h,
--      rsvp 24 h -- so their history was wiped before it could count.
--      Those limits never fired.
--
-- What this does:
--
--   * Same signature, so the builds already in the field keep working;
--     p_user_id is now ignored. Identity comes from auth.uid() and a NULL
--     uid (anon, or a broken JWT) is denied.
--   * Per-action ceilings live here. A client can only tighten them.
--   * GC retention becomes 1 day, the longest window in use, in both places.
--   * EXECUTE is revoked from anon and PUBLIC.
--
-- Client call sites (unchanged in this migration, still pass p_user_id):
--   app/fan-group/[id].tsx     message_send  60 / 60 s
--   app/create-clip.tsx        clip_post      5 / 3600 s
--   app/watch-party/[id].tsx   rsvp          20 / 86400 s
--   components/MomentsFeed.tsx moment_post   10 / 3600 s
--
-- Review before applying to production. Non-destructive: no table or row
-- is dropped; one function is replaced and one cron command is altered.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_user_id        UUID,
    p_action         TEXT,
    p_max_count      INT DEFAULT 60,
    p_window_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid          UUID;
    v_max          INT;
    v_window       INT;
    v_window_start TIMESTAMPTZ;
    v_count        INT;
BEGIN
    -- The caller's argument is deliberately unused. Identity is the JWT's.
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Server-side ceilings per action. These are the numbers the client
    -- code already sends; putting them here means the client can no
    -- longer send anything looser.
    CASE p_action
        WHEN 'message_send' THEN v_max := 60; v_window := 60;
        WHEN 'clip_post'    THEN v_max := 5;  v_window := 3600;
        WHEN 'moment_post'  THEN v_max := 10; v_window := 3600;
        WHEN 'rsvp'         THEN v_max := 20; v_window := 86400;
        ELSE                     v_max := 60; v_window := 60;
    END CASE;

    -- A client may tighten (fewer actions, longer window) but never loosen.
    v_max    := LEAST(COALESCE(p_max_count, v_max), v_max);
    v_window := GREATEST(COALESCE(p_window_seconds, v_window), v_window);

    v_window_start := now() - (v_window || ' seconds')::interval;

    SELECT COALESCE(SUM(count), 0) INTO v_count
    FROM public.rate_limits
    WHERE user_id = v_uid
      AND action = p_action
      AND window_start >= v_window_start;

    IF v_count >= v_max THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.rate_limits (user_id, action)
    VALUES (v_uid, p_action);

    -- Probabilistic GC (~1% of calls). Retention must cover the longest
    -- window in use or that window can never fill.
    IF random() < 0.01 THEN
        DELETE FROM public.rate_limits
        WHERE window_start < now() - interval '1 day';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) TO authenticated;

COMMENT ON FUNCTION public.check_rate_limit(UUID, TEXT, INT, INT) IS
  'Per-user action rate limiter. Identity is auth.uid(); p_user_id is ignored (mig 099). Ceilings per action are enforced server-side; callers may only tighten them.';

-- The cron GC from migration 052 deleted anything older than 5 minutes.
-- Use cron.alter_job so this replays from both Studio and the CLI
-- (Studio cannot UPDATE cron.job directly).
DO $$
DECLARE
    v_jobid BIGINT;
BEGIN
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'gc-rate-limits';
    IF v_jobid IS NOT NULL THEN
        PERFORM cron.alter_job(
            job_id  => v_jobid,
            command => $cmd$DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '1 day'$cmd$
        );
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ─── Verification (run as a signed-in user in the SQL editor) ─────────
--
--   -- 1. anon is denied:
--   SET ROLE anon;
--   SELECT public.check_rate_limit(gen_random_uuid(), 'message_send', 60, 60);
--   -- expect: permission denied for function check_rate_limit
--   RESET ROLE;
--
--   -- 2. a spoofed p_user_id does not change whose bucket is counted:
--   SELECT public.check_rate_limit(gen_random_uuid(), 'message_send', 60, 60);
--   SELECT user_id FROM public.rate_limits ORDER BY window_start DESC LIMIT 1;
--   -- expect: the caller's auth.uid(), not the random UUID
--
--   -- 3. a permissive limit is clamped:
--   SELECT public.check_rate_limit(auth.uid(), 'clip_post', 1000000, 1);
--   -- runs against the 5 / 3600 s ceiling regardless
--
--   -- 4. the cron retention changed:
--   SELECT command FROM cron.job WHERE jobname = 'gc-rate-limits';
--   -- expect: interval '1 day'
