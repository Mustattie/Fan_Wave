-- 092: something has to read the tables that already knew.
--
-- WHY:
--   Three production failures were found by hand on 2026-08-31/09-01, and all
--   three had been recording their own failure the whole time:
--
--     * ESPN 403'd the schedule sync for 4 days. pg_cron logged "succeeded",
--       pg_net logged 200, the body said success:true with totalSynced 0.
--     * trigger-scheduled-notifications had failed every 5 minutes for months
--       -- 288 failures in the 24h before it was noticed -- each one written
--       to cron.job_run_details.
--     * the notification queue was never drained, so nothing was delivered.
--
--   Nothing reads cron.job_run_details or net._http_response, so all of it was
--   invisible. This migration reads them every 15 minutes and pushes to the
--   owner when something is wrong.
--
-- WHAT IT CHECKS
--   1. cron jobs that FAILED in the last hour                (the obvious one)
--   2. pg_net responses with status >= 400 in the last hour  (edge functions;
--      cron reports "succeeded" for these because the SQL ran fine)
--   3. game data staleness                                   (the important one)
--
--   Check 3 is the lesson from the ESPN outage: it reported success at every
--   layer and the only real symptom was that the games table stopped
--   advancing. Status codes cannot catch a system that is lying; an outcome
--   check can. If fewer than 5 games are scheduled in the next 3 days,
--   something upstream is broken regardless of what it claims.
--
-- DELIVERY
--   Push, via enqueue_notifications -> notification_queue ->
--   drain-notification-queue (migration 091). Reuses the pipeline rather than
--   inventing a channel, and there is no email API key on this project.
--   Recipients are an explicit email allowlist, not "all users".
--
-- LIMIT WORTH NAMING
--   This runs on pg_cron, so it cannot report that pg_cron itself is dead. It
--   catches individual job failures, not total scheduler failure. Watching for
--   that needs something outside the database.

-- ─── 1. What is wrong right now ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ops_health_problems()
RETURNS TABLE (kind TEXT, problem_key TEXT, detail TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
  -- 1. cron jobs failing
  SELECT
    'cron_failed'::TEXT,
    j.jobname::TEXT,
    (count(*)::TEXT || ' failure(s) in 1h: ' || left(COALESCE(max(d.return_message), ''), 90))
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status = 'failed'
    AND d.start_time > now() - interval '1 hour'
  GROUP BY j.jobname

  UNION ALL

  -- 2. edge functions answering with an error. cron calls these "succeeded"
  --    because the SQL that fired them ran fine, so this is the only place
  --    the failure surfaces.
  SELECT
    'http_error'::TEXT,
    COALESCE(r.status_code::TEXT, 'no-response'),
    (count(*)::TEXT || ' response(s) in 1h, e.g. ' || left(COALESCE(max(r.content), max(r.error_msg), ''), 90))
  FROM net._http_response r
  WHERE r.created > now() - interval '1 hour'
    AND (r.status_code IS NULL OR r.status_code >= 400)
  GROUP BY r.status_code

  UNION ALL

  -- 3. the outcome check: is the schedule actually advancing?
  SELECT
    'games_stale'::TEXT,
    'upcoming_3d'::TEXT,
    ('only ' || count(*)::TEXT || ' game(s) scheduled in the next 3 days -- sync may be failing silently')
  FROM public.games
  WHERE scheduled_at BETWEEN now() AND now() + interval '3 days'
  HAVING count(*) < 5;
$$;

REVOKE EXECUTE ON FUNCTION public.ops_health_problems() FROM PUBLIC;

COMMENT ON FUNCTION public.ops_health_problems() IS
  'Current operational problems: failing cron jobs, 4xx/5xx edge function responses, and a games-freshness outcome check. See migration 092.';

-- ─── 2. Alert on anything new ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_ops_health_check()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_ref UUID;
  v_new TEXT[] := '{}';
  v_tokens TEXT[];
  v_msgs JSONB := '[]'::jsonb;
  v_token TEXT;
  v_body TEXT;
BEGIN
  FOR r IN SELECT * FROM public.ops_health_problems() LOOP
    -- One alert per problem per hour. notification_log already exists for
    -- exactly this kind of dedup, keyed by a deterministic uuid.
    v_ref := md5(r.kind || '|' || r.problem_key || '|' ||
                 to_char(date_trunc('hour', now()), 'YYYYMMDDHH24'))::uuid;

    IF EXISTS (SELECT 1 FROM public.notification_log
                WHERE ref_id = v_ref AND type = 'ops_alert') THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notification_log (ref_id, type) VALUES (v_ref, 'ops_alert');
    v_new := v_new || (r.kind || ': ' || r.problem_key || ' — ' || r.detail);
  END LOOP;

  IF array_length(v_new, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Owner devices only. An ops alert is not a user-facing notification.
  SELECT array_agg(u.push_token) INTO v_tokens
  FROM public.users u
  JOIN auth.users a ON a.id = u.auth_id
  WHERE u.push_token IS NOT NULL
    AND lower(a.email) IN ('mustattie@gmail.com');

  IF v_tokens IS NULL THEN
    RAISE NOTICE 'ops problems found but no owner push token on file: %', v_new;
    RETURN array_length(v_new, 1);
  END IF;

  v_body := left(array_to_string(v_new, ' | '), 300);

  FOREACH v_token IN ARRAY v_tokens LOOP
    v_msgs := v_msgs || jsonb_build_object(
      'push_token', v_token,
      'title', 'Fan Sphere: ' || array_length(v_new, 1)::text || ' ops problem(s)',
      'body', v_body,
      'data', jsonb_build_object('type', 'ops_alert'),
      'sound', 'default'
    );
  END LOOP;

  PERFORM public.enqueue_notifications(v_msgs);
  RETURN array_length(v_new, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_ops_health_check() FROM PUBLIC;

COMMENT ON FUNCTION public.run_ops_health_check() IS
  'Pushes newly-detected ops problems to the owner, deduped hourly via notification_log. Returns how many new problems were alerted. See migration 092.';

-- ─── 3. Every 15 minutes ───────────────────────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ops-health-check';
  IF v_jobid IS NULL THEN
    PERFORM cron.schedule('ops-health-check', '*/15 * * * *',
                          'SELECT public.run_ops_health_check();');
  ELSE
    PERFORM cron.alter_job(v_jobid, schedule => '*/15 * * * *',
                           command => 'SELECT public.run_ops_health_check();');
  END IF;
END;
$$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- What is wrong right now (should be empty on a healthy system):
--   SELECT * FROM public.ops_health_problems();
--
--   -- Run the checker by hand; returns the count of NEW problems alerted:
--   SELECT public.run_ops_health_check();
--
--   -- Prove check 3 works by pretending the sync died:
--   --   it reports games_stale whenever the next 3 days hold under 5 games.
