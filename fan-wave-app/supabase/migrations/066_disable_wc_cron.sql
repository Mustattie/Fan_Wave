-- 066: Disable the espn_sync_worldcup_fast pg_cron job.
--
-- WHY:
--   v9.0 pivots away from the dedicated World Cup 2026 tab and treats the
--   tournament as one event among many rather than a first-class hero
--   surface. There is no more product need for a bumped 2-minute sync
--   window covering only worldcup fixtures — the standard schedule is
--   sufficient. Legacy WC Pass holders were grandfathered to Premium in
--   migration 065; the entitlement lane collapses under Premium going
--   forward.
--
-- WHICH JOBS REMAIN ACTIVE (untouched by this migration):
--   - espn_sync_schedule  — every 5 min, full sync of all sports
--     (worldcup already flows through this path via
--     invoke_espn_sync() with no sport arg).
--   - espn_sync_live      — every 1 min, guarded on any game.status='in'
--     so the loop is a cheap EXISTS check when nothing is live.
--   Both were scheduled in migration 058 and continue to cover all
--   sports including any residual worldcup fixtures.
--
-- WHAT THIS MIGRATION DOES:
--   Flips cron.job.active = false for the espn_sync_worldcup_fast job.
--   The row stays in place — future v9.x could re-enable it if we ever
--   repurpose the 2-minute lane for a similar hero-event window (e.g.
--   Olympics, playoffs) without needing to redefine the SQL body. To
--   fully remove the row, a later migration would need to call
--   cron.unschedule('espn_sync_worldcup_fast').
--
-- SAFETY:
--   - Idempotent: DO block only touches the row if it exists AND is
--     currently active. Missing job → no-op success. Already-disabled
--     job → no-op success.
--   - Non-destructive: no cron.unschedule(), no schema changes, no
--     entitlement / data mutations.
--   - Ordering: has no dependency on migration 065 (that migration
--     only touches public.users + public.entitlement_migrations; this
--     one only touches cron.job). Safe to run in either order, but the
--     numeric sequence 065 → 066 is what supabase db push will apply.

-- IMPORTANT (2026-07-09): direct UPDATE on cron.job is rejected in the
-- Supabase Studio SQL editor because the interactive role lacks table-
-- level UPDATE on the cron schema (permission denied for table job).
-- The pg_cron sanctioned API cron.alter_job() carries the right grants
-- and works from both Studio and CLI (`supabase db push`), so we call
-- through it here instead of mutating the row directly.

DO $$
DECLARE
  v_jobid         BIGINT;
  v_before_active BOOLEAN;
BEGIN
  SELECT jobid, active
    INTO v_jobid, v_before_active
    FROM cron.job
   WHERE jobname = 'espn_sync_worldcup_fast';

  IF NOT FOUND THEN
    RAISE NOTICE
      '[066_disable_wc_cron] job espn_sync_worldcup_fast not found — nothing to do';
    RETURN;
  END IF;

  IF v_before_active IS DISTINCT FROM TRUE THEN
    RAISE NOTICE
      '[066_disable_wc_cron] job espn_sync_worldcup_fast already inactive — no-op';
    RETURN;
  END IF;

  PERFORM cron.alter_job(job_id := v_jobid, active := false);

  RAISE NOTICE
    '[066_disable_wc_cron] disabled espn_sync_worldcup_fast via cron.alter_job (row preserved for future re-enable)';
END
$$;

-- Verification snippet (run manually after apply):
--
--   SELECT jobname, schedule, active
--     FROM cron.job
--    WHERE jobname LIKE 'espn_sync_%'
--    ORDER BY jobname;
--   -- expect:
--   --   espn_sync_live            * * * * *    t
--   --   espn_sync_schedule        */5 * * * *  t
--   --   espn_sync_worldcup_fast   */2 * * * *  f
