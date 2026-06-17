-- 058: Repair ESPN sync cron URL + register Soccer Cup as a synced sport.
--
-- Two related fixes that together make Soccer Cup fixtures populate from
-- ESPN on prod.
--
-- A. invoke_espn_sync URL repair.
--    Migration 029 hardcoded the edge-function URL to the OLD dev
--    project (`azkmymxdjylmkytrvyfn`). On 2026-06-09 a dedicated prod
--    Supabase project (`fwlfiejvxmslkpoojggs`) was stood up and all
--    migrations were replayed — including 029 — so prod's pg_cron has
--    been firing HTTP POSTs into the DEV project's edge function for
--    the last week. That means prod's `games` table never gets fresh
--    ESPN data, regardless of which sports are mapped. This re-creates
--    the helper with the correct prod URL.
--
-- B. Soccer Cup sport registration.
--    The sync-game-schedules edge function (deployed alongside this
--    migration) gains a new `worldcup` entry in SPORT_LEAGUE_MAP
--    pointing at ESPN's `soccer/fifa.world` scoreboard endpoint. Because
--    that adapter does `leagues.name ILIKE :sport` to find the league
--    row, the function uses a `leagueName` field for the lookup —
--    "Soccer Cup" — which already exists (migration 048). No new league
--    row needed.
--
--    For the cron side, the existing `espn_sync_schedule` job (every 5
--    min, no sport param) iterates ALL_SPORTS in the edge function, so
--    Soccer Cup is picked up automatically once the function is
--    redeployed. We add a separate `espn_sync_worldcup_fast` job to
--    bump the cadence on Soccer Cup specifically while the tournament
--    is in flight (every 2 min during 2026-06-11 → 2026-07-19 window).
--    Outside the window the job no-ops via the date-range guard, so
--    leaving it scheduled forever is safe.

-- ─── A. Replace invoke_espn_sync with prod URL ─────────────────────
CREATE OR REPLACE FUNCTION public.invoke_espn_sync(p_sport TEXT DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $func$
DECLARE
  v_base_url TEXT := 'https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/sync-game-schedules';
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

REVOKE EXECUTE ON FUNCTION public.invoke_espn_sync(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_espn_sync(TEXT) FROM authenticated, anon;

-- ─── Authoritative reschedule (idempotent) ─────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_schedule') THEN
    PERFORM cron.unschedule('espn_sync_schedule');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_live') THEN
    PERFORM cron.unschedule('espn_sync_live');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_worldcup_fast') THEN
    PERFORM cron.unschedule('espn_sync_worldcup_fast');
  END IF;
END $$;

-- Every 5 min: full sync of all sports (now includes worldcup).
SELECT cron.schedule(
  'espn_sync_schedule',
  '*/5 * * * *',
  $cron$ SELECT public.invoke_espn_sync(); $cron$
);

-- Every 1 min: live-score sync ONLY if any game is in-progress.
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

-- Every 2 min during the Soccer Cup window (2026-06-11 → 2026-07-19):
-- bumped cadence so fixtures + scores feel fresh while the tournament
-- is in flight. Date guard makes this a no-op outside the window.
SELECT cron.schedule(
  'espn_sync_worldcup_fast',
  '*/2 * * * *',
  $cron$
    DO $body$
    BEGIN
      IF (CURRENT_DATE BETWEEN DATE '2026-06-11' AND DATE '2026-07-19') THEN
        PERFORM public.invoke_espn_sync('worldcup');
      END IF;
    END
    $body$;
  $cron$
);

-- Inspect with:
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT jobid, status, return_message, start_time, end_time
--     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
