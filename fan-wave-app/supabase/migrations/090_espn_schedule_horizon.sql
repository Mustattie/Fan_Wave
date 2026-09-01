-- 090: the schedule only reaches 7 days ahead, so NFL is invisible until the
-- week of kickoff.
--
-- WHY:
--   Checked 2026-09-01, with the NFL opener on 2026-09-14:
--
--     NFL games in the next 14 days : 0
--     first upcoming NFL kickoff    : none
--     next 14d by sport             : cfb=91, mlb=115, mls=15
--
--   sync-game-schedules defaults to `days=7` and invoke_espn_sync() never
--   passes anything else, so the catalogue is a rolling one-week window. For a
--   launch built around the NFL season opener that means Game Day and Home
--   render empty for the entire run-up, and nobody can create a watch party
--   against a game that does not exist in the DB yet.
--
-- WHY NOT JUST WIDEN THE DEFAULT:
--   getUpcomingGames walks the window a day at a time -- one ESPN request per
--   sport per day. At 9 sports that is 72 requests per run today, and
--   espn_sync_schedule runs every 5 minutes: ~864/hour. A 30-day default would
--   make it 279 per run, ~3,350/hour, against a host that already
--   fingerprint-blocks us (v9.4.9: ESPN 403s Deno's User-Agent). Hammering it
--   invites exactly the block we just spent a day diagnosing, and that block
--   fails silently.
--
--   So the frequent job stays at 7 days for freshness, and a separate daily
--   job reaches 30 days for schedule depth. Same function, different window.
--
-- WHAT:
--   1. invoke_espn_sync gains p_days. DROP + CREATE rather than an overload:
--      a second function with all-defaulted params would make the existing
--      zero-arg call `invoke_espn_sync()` ambiguous and break both live and
--      schedule crons.
--   2. New daily `espn_sync_horizon` job at 08:20 UTC (a quiet hour, and off
--      the :00/:05 marks the other jobs use).

-- ─── 1. invoke_espn_sync(p_sport, p_days) ──────────────────────────
DROP FUNCTION IF EXISTS public.invoke_espn_sync(TEXT);

CREATE OR REPLACE FUNCTION public.invoke_espn_sync(
  p_sport TEXT DEFAULT NULL,
  p_days  INT  DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_base_url TEXT := 'https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/sync-game-schedules';
  v_url TEXT;
  v_key TEXT;
  v_qs TEXT := '';
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

  IF p_sport IS NOT NULL THEN
    v_qs := '?sport=' || p_sport;
  END IF;

  -- The function clamps days to 1..30 itself; passing through unclamped is
  -- fine and keeps the clamp in one place.
  IF p_days IS NOT NULL THEN
    v_qs := v_qs || CASE WHEN v_qs = '' THEN '?' ELSE '&' END || 'days=' || p_days::text;
  END IF;

  v_url := v_base_url || v_qs;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 90000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_espn_sync(TEXT, INT) FROM PUBLIC;

COMMENT ON FUNCTION public.invoke_espn_sync(TEXT, INT) IS
  'Posts to sync-game-schedules with the vault service role key. p_days widens the forward window (function clamps 1..30); NULL leaves the function default of 7. See migrations 029 and 090.';

-- ─── 2. Daily long-horizon sync ────────────────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'espn_sync_horizon';
  IF v_jobid IS NULL THEN
    PERFORM cron.schedule(
      'espn_sync_horizon',
      '20 8 * * *',
      'SELECT public.invoke_espn_sync(NULL, 30);'
    );
  ELSE
    PERFORM cron.alter_job(
      v_jobid,
      schedule => '20 8 * * *',
      command  => 'SELECT public.invoke_espn_sync(NULL, 30);'
    );
  END IF;
END;
$$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- The existing zero-arg calls still resolve (no ambiguity):
--   SELECT public.invoke_espn_sync();
--
--   -- Pull a month immediately rather than waiting for 08:20:
--   SELECT public.invoke_espn_sync(NULL, 30);
--
--   -- Then NFL should be present well before kickoff:
--   SELECT count(*) FROM public.games
--   WHERE sport_id = 'nfl' AND scheduled_at > now();
