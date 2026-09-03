-- 091: close the notification chain, and lock the tables that would make
-- closing it dangerous.
--
-- These two changes MUST ship together, and in this order.
--
-- WHY (the hole):
--   Audited 2026-09-01. Several tables in `public` have no row level security
--   and grant SELECT/INSERT/UPDATE/DELETE/TRUNCATE to `anon` and
--   `authenticated`:
--
--     notification_queue, notification_queue_partitioned, nq_p2026_*, nq_default,
--     messages_partitioned, messages_p2026_*, messages_default,
--     analytics_events_partitioned, analytics_events_p2026_*, analytics_events_default
--
--   They are the partitioning scaffolding from migrations 017-019 that the app
--   was never cut over to, so they are all empty and nothing leaks today. The
--   tables that actually hold data -- `messages` (41 rows) and
--   `analytics_events` (20) -- do have RLS.
--
--   PostgREST does not expose individual partitions, but it does expose the
--   parents: GET /rest/v1/notification_queue with the app's anon key returns
--   200. That key ships inside the app bundle and is trivially extractable.
--
-- WHY (why it becomes urgent now):
--   process-notification-queue reads notification_queue and pushes each row's
--   push_token/title/body to Expo. No cron has ever invoked it, so the queue
--   is written by trigger-notifications and never drained -- scheduled
--   notifications have therefore never been delivered from production, which
--   is the second half of the bug migration 088 only half-fixed.
--
--   Scheduling that worker without locking the table first would turn a dormant
--   hole into a live one: anyone with the anon key could INSERT rows and have
--   our own worker deliver arbitrary push notifications. Hence one migration.
--
-- WHAT:
--   1. RLS on + client grants revoked for every public table still missing RLS.
--   2. invoke_process_notification_queue(), vault-backed like its siblings.
--   3. That worker scheduled every minute.
--
-- SAFETY:
--   * service_role bypasses RLS, so the worker and the edge functions are
--     unaffected. Only anon/authenticated lose access, and they never legitimately
--     had it -- these tables are unused by the client.
--   * Enabling RLS with no policy denies by default. That is the intent: these
--     are internal tables, not client surfaces.
--   * The loop is dynamic so partitions added later by the 019 helper get the
--     same treatment on replay.

-- ─── 1. Lock every public table that still lacks RLS ───────────────
DO $$
DECLARE
  r RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')       -- ordinary + partitioned
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.relname);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'locked % table(s)', v_count;
END;
$$;

-- ─── 2. Vault-backed invoker for the queue worker ──────────────────
CREATE OR REPLACE FUNCTION public.invoke_process_notification_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url TEXT := 'https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/process-notification-queue';
  v_key TEXT;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'fan_wave_service_role_key'
  LIMIT 1;

  IF v_key IS NULL THEN
    RAISE EXCEPTION
      'Vault secret "fan_wave_service_role_key" not found. Run: '
      'SELECT vault.create_secret(''YOUR_SERVICE_ROLE_KEY'', ''fan_wave_service_role_key'');';
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_process_notification_queue() FROM PUBLIC;

COMMENT ON FUNCTION public.invoke_process_notification_queue() IS
  'Drains notification_queue via the process-notification-queue edge function. Without this the queue is written and never read, which is how scheduled notifications went undelivered from production. See migration 091.';

-- ─── 3. Schedule it ────────────────────────────────────────────────
-- Every minute: a game reminder fires 30 minutes before kickoff, so latency
-- here is user-visible. The function self-limits with MAX_BATCHES_PER_RUN.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'drain-notification-queue';
  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'drain-notification-queue',
      '* * * * *',
      'SELECT public.invoke_process_notification_queue();'
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      schedule => '* * * * *',
      command  => 'SELECT public.invoke_process_notification_queue();'
    );
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Nothing left unprotected:
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
--   -- expect: zero rows
--
--   -- The anon key can no longer read the queue:
--   curl "$URL/rest/v1/notification_queue?select=*" -H "apikey: $ANON"
--   -- expect: 401/permission denied, not 200 []
--
--   -- The worker runs and is authorised:
--   SELECT status_code, left(content,120) FROM net._http_response ORDER BY created DESC LIMIT 3;
--   -- expect: 200 from process-notification-queue, not 401
