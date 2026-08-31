-- 088: trigger-scheduled-notifications has never fired on prod.
--
-- WHY:
--   The job scheduled by migration 010 builds its request inline from two
--   GUCs:
--
--     url     := current_setting('app.settings.supabase_url')     || '/functions/v1/trigger-notifications'
--     headers := ... current_setting('app.settings.service_role_key')
--
--   Those settings only exist if someone has run ALTER DATABASE ... SET on
--   the project. Nobody has, so every single run dies with:
--
--     ERROR: unrecognized configuration parameter "app.settings.supabase_url"
--
--   288 failed runs in the 24h before this migration -- one every five
--   minutes, indefinitely. cron.job_run_details records status='failed', but
--   nothing reads that table, so no scheduled notification has ever been
--   delivered from production and nothing said so.
--
--   Migration 029 already solved this problem for the ESPN sync: read the
--   service role key from vault inside a SECURITY DEFINER function, hardcode
--   the project URL, and let the cron entry call the function. That pattern
--   survives JWT rotations and needs no database-level settings. This
--   migration brings the notification job onto it.
--
-- WHAT:
--   1. public.invoke_trigger_notifications() -- vault-backed invoker, an
--      exact structural twin of public.invoke_espn_sync().
--   2. Repoints the existing cron entry at it.
--
-- SAFETY:
--   * The function RAISEs a named, actionable exception when the vault secret
--     is missing rather than posting an unauthenticated request that would
--     401 quietly -- the same failure mode we are here to remove.
--   * cron.alter_job(), not UPDATE cron.job: the Studio SQL editor cannot
--     UPDATE the cron catalog, so a plain UPDATE makes this migration
--     unreplayable in Studio while succeeding under the CLI.
--   * Falls back to cron.schedule() when the job is absent, so this is
--     idempotent on a fresh project.

-- ─── 1. Vault-backed invoker ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_trigger_notifications()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url TEXT := 'https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/trigger-notifications';
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
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_trigger_notifications() FROM PUBLIC;

COMMENT ON FUNCTION public.invoke_trigger_notifications() IS
  'Posts to the trigger-notifications edge function using the service role key from vault. Called by the trigger-scheduled-notifications cron job. See migration 088; mirrors invoke_espn_sync (migration 029).';

-- ─── 2. Repoint the cron entry ─────────────────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'trigger-scheduled-notifications';

  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'trigger-scheduled-notifications',
      '*/5 * * * *',
      'SELECT public.invoke_trigger_notifications();'
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      command => 'SELECT public.invoke_trigger_notifications();'
    );
  END IF;
END;
$$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Command no longer references the GUCs:
--   SELECT command FROM cron.job WHERE jobname = 'trigger-scheduled-notifications';
--   -- expect: SELECT public.invoke_trigger_notifications();
--
--   -- Next runs succeed (wait 5 minutes, or call the function directly):
--   SELECT status, return_message, start_time
--   FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--   WHERE j.jobname = 'trigger-scheduled-notifications'
--   ORDER BY start_time DESC LIMIT 3;
--   -- expect: status='succeeded'
--
--   -- And the request actually reached the function:
--   SELECT status_code, left(content, 200) FROM net._http_response
--   ORDER BY created DESC LIMIT 3;
--   -- expect: 200 from trigger-notifications, not 401
