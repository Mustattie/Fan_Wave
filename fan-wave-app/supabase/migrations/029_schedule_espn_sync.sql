-- 029: schedule ESPN sync via pg_cron + pg_net.
--
-- The sync-game-schedules edge function exists and works, but nothing
-- invokes it on a schedule — so game data stays stale. This migration
-- enables pg_cron and pg_net, then schedules two jobs:
--
--   * espn_sync_schedule — every 5 minutes, full schedule sync (next 7
--     days). Captures new fixtures and finalised scores.
--   * espn_sync_live — every 1 minute, but only fires the HTTP call if
--     at least one row in `games` has status='in'. Lifts live-game
--     score freshness from 5 min to ~60s without paying the cron-cost
--     during off hours.
--
-- Both jobs call the same edge function (sync-game-schedules) — the
-- public ESPN scoreboard returns today's games regardless of state, so
-- "live-only" here means polling cadence, not endpoint variant.
--
-- ─── ONE-TIME SETUP REQUIRED ─────────────────────────────────────────
-- Before the cron jobs can succeed, store the service-role key in
-- Supabase Vault. Run this once (replace the literal with the actual
-- key from Project Settings → API → service_role secret):
--
--   SELECT vault.create_secret(
--     'eyJ…YOUR_SERVICE_ROLE_KEY…',
--     'fan_wave_service_role_key'
--   );
--
-- If the secret is missing when a cron job fires, invoke_espn_sync()
-- raises a clear exception (visible in cron.job_run_details) — no
-- silent failures, no data loss; the schedule just no-ops until the
-- secret is in place.
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper that fires one HTTP POST to the sync-game-schedules edge
-- function. SECURITY DEFINER so cron's running role can read the vault
-- secret without needing service-role grants on vault.decrypted_secrets.
CREATE OR REPLACE FUNCTION public.invoke_espn_sync(p_sport TEXT DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $func$
DECLARE
  v_base_url TEXT := 'https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/sync-game-schedules';
  v_url TEXT;
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

  v_url := CASE
    WHEN p_sport IS NOT NULL THEN v_base_url || '?sport=' || p_sport
    ELSE v_base_url
  END;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$func$;

-- Lock down: only the postgres role / pg_cron worker should call this.
REVOKE EXECUTE ON FUNCTION public.invoke_espn_sync(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_espn_sync(TEXT) FROM authenticated, anon;

-- Idempotent reschedule: drop old jobs by name if present, then create
-- fresh. Safe to run this migration multiple times.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_schedule') THEN
    PERFORM cron.unschedule('espn_sync_schedule');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_live') THEN
    PERFORM cron.unschedule('espn_sync_live');
  END IF;
END $$;

-- Job 1: full schedule sync every 5 minutes
SELECT cron.schedule(
  'espn_sync_schedule',
  '*/5 * * * *',
  $cron$ SELECT public.invoke_espn_sync(); $cron$
);

-- Job 2: live-only sync every minute, guarded so the HTTP call only
-- fires when at least one game has status='in'. The SELECT 1 check is
-- ~1 ms; the HTTP call is the expensive part, and we skip it 99% of
-- the day this way.
SELECT cron.schedule(
  'espn_sync_live',
  '* * * * *',
  $cron$
    DO $body$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.games WHERE status = 'in' LIMIT 1) THEN
        PERFORM public.invoke_espn_sync();
      END IF;
    END
    $body$;
  $cron$
);

-- Inspect with:
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT jobid, status, return_message, start_time, end_time
--     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
