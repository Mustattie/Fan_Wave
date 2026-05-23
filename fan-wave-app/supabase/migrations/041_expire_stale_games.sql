-- 041: prune stale 'scheduled' games + hourly cron to keep them pruned.
--
-- The sync-game-schedules function only inserts/updates games that ESPN
-- currently returns in its 7-day-forward window. A game that drops out of
-- that window (because it's now past) is never touched again — its status
-- column stays 'scheduled' indefinitely, even though it actually ended.
--
-- Symptom that triggered this: 2026-05-21 Knicks vs Cavaliers (ended last
-- night) was still status='scheduled' the next day, appeared on the home
-- screen carousel sorted ahead of today's actual NBA game (Spurs vs
-- Thunder) — wrong-game-shown bug.
--
-- Fix: any game whose scheduled_at is more than 6 hours in the past and
-- whose status is still 'scheduled' clearly never got its status updated
-- by the sync. Mark it 'post' so the home screen filter excludes it.
-- Live games (status='in') aren't touched — only orphaned scheduled rows.

-- ─── 1. One-shot cleanup of existing backlog ─────────────────────────
UPDATE games
SET status = 'post'
WHERE status = 'scheduled'
  AND scheduled_at < now() - interval '6 hours';

-- ─── 2. Hourly cron to keep it clean going forward ───────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire_stale_games') THEN
    PERFORM cron.unschedule('expire_stale_games');
  END IF;
END $$;

SELECT cron.schedule(
  'expire_stale_games',
  '0 * * * *', -- top of every hour
  $cron$
    UPDATE games SET status = 'post'
    WHERE status = 'scheduled'
      AND scheduled_at < now() - interval '6 hours';
  $cron$
);

-- Inspect cleanup result and cron registration with:
--   SELECT status, COUNT(*) FROM games GROUP BY status;
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='expire_stale_games';
