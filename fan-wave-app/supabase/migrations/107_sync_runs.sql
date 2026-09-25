-- 107: game-sync run ledger for freshness monitoring (P3.2, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Needs owner approval; apply via the
-- Management API query endpoint. Pair with the prepared changes to
-- supabase/functions/sync-game-schedules (writes a row per run) and
-- supabase/functions/health-check (reads max(finished_at)). Apply this
-- FIRST; the function writes are best-effort and swallow a missing table.
--
-- Finding: nothing records when the ESPN sync last succeeded. The only
-- proxy is mig 092's "fewer than 5 games in the next 3 days" check, which
-- cannot tell "sync is dead" from "quiet week".

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,                 -- 'espn'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  ok            BOOLEAN,
  games_seen    INT,
  games_written INT,
  games_skipped INT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source_finished
  ON public.sync_runs (source, finished_at DESC);

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
-- No policies: service_role (the edge functions) only.

-- Keep 30 days.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-sync-runs') THEN
    PERFORM cron.schedule(
      'purge-sync-runs',
      '23 3 * * *',
      $cron$ DELETE FROM public.sync_runs WHERE started_at < now() - interval '30 days'; $cron$
    );
  END IF;
END $$;

-- Freshness query used by health-check:
--   SELECT extract(epoch FROM now() - max(finished_at)) AS age_seconds
--   FROM public.sync_runs WHERE source = 'espn' AND ok;

-- Reversal:
--   SELECT cron.unschedule('purge-sync-runs');
--   DROP TABLE IF EXISTS public.sync_runs;
