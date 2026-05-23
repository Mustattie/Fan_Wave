-- 038: weekly cron for sync-team-logos.
--
-- Logos rarely change (a re-brand maybe once a year per league), so the
-- schedule is intentionally lazy — Monday 09:00 UTC, weekly. Mirrors
-- the pattern from migration 029 (invoke_espn_sync). Same vault secret
-- (fan_wave_service_role_key) is reused; the edge function accepts it as
-- a bearer because it holds CRON_SHARED_SECRET after the rotation in
-- commit e832d4a.

CREATE OR REPLACE FUNCTION public.invoke_team_logo_sync(p_sport TEXT DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $func$
DECLARE
  v_base_url TEXT := 'https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/sync-team-logos';
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
      'SELECT vault.create_secret(''YOUR_BEARER'', ''fan_wave_service_role_key'');';
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
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.invoke_team_logo_sync(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_team_logo_sync(TEXT) FROM authenticated, anon;

-- Idempotent reschedule: drop old job by name if present, then create fresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'espn_sync_team_logos') THEN
    PERFORM cron.unschedule('espn_sync_team_logos');
  END IF;
END $$;

-- Weekly: Monday 09:00 UTC
SELECT cron.schedule(
  'espn_sync_team_logos',
  '0 9 * * 1',
  $cron$ SELECT public.invoke_team_logo_sync(); $cron$
);

-- ─── Manual one-shot backfill (run after applying this migration) ────
-- Fires immediately to fill in null logo_urls without waiting for Monday:
--
--   SELECT public.invoke_team_logo_sync();
--
-- Inspect the request:
--   SELECT id, status_code, content::text
--     FROM net._http_response WHERE id = <returned-id>;
--
-- Verify the backfill:
--   SELECT sport_id_or_league, COUNT(*) FILTER (WHERE logo_url IS NULL) AS missing,
--          COUNT(*) AS total
--     FROM teams t JOIN leagues l ON l.id = t.league_id GROUP BY l.id;
