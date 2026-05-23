-- 042: extend stale-game cleanup to also catch orphaned 'in' games.
--
-- Migration 041 added a cron + one-shot cleanup for status='scheduled'
-- games whose scheduled_at had passed. The same root cause applies to
-- status='in' games — once a game ends and ESPN drops it from its
-- scoreboard (MLB drops finished games quickly because 15+ are played
-- per day), our sync never sees the STATUS_FINAL transition and the row
-- stays status='in' forever, with stale score + inning data, surfaced
-- in the UI as a LIVE game.
--
-- Symptom that triggered this: home screen showed "Miami Marlins 1-3
-- Atlanta Braves · LIVE · Top 6th" at noon CT, while ESPN's actual MLB
-- slate for the day was an entirely different set of matchups.
-- Diagnostic also revealed 17 mlb rows at status='in' — far more than
-- the 2-4 games actually being played at that hour.
--
-- Fix:
--   * Extend the cleanup to mark status='in' games as 'post' when
--     scheduled_at is more than 8 hours in the past. 8 hours > any
--     plausible single-game duration including rain delays + extra
--     innings. Worst plausible miss: a Cup Final game that went 5OT
--     (4h45m total game time, ~6h from scheduled start including
--     pre-game) — still inside the buffer.
--   * Bump the cron from hourly to every 10 minutes — stale "LIVE"
--     labels are far more visible to users than stale 'scheduled'
--     rows, and the UPDATE is cheap (<1s on a small games table).

-- ─── 1. One-shot cleanup of the existing backlog ─────────────────────
UPDATE games SET status = 'post'
WHERE (status = 'scheduled' AND scheduled_at < now() - interval '6 hours')
   OR (status = 'in'        AND scheduled_at < now() - interval '8 hours');

-- ─── 2. Recreate the cron with extended condition + faster cadence ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire_stale_games') THEN
    PERFORM cron.unschedule('expire_stale_games');
  END IF;
END $$;

SELECT cron.schedule(
  'expire_stale_games',
  '*/10 * * * *',
  $cron$
    UPDATE games SET status = 'post'
    WHERE (status = 'scheduled' AND scheduled_at < now() - interval '6 hours')
       OR (status = 'in'        AND scheduled_at < now() - interval '8 hours');
  $cron$
);

-- Verify with:
--   SELECT sport_id,
--          COUNT(*) FILTER (WHERE status='in')        AS live_now,
--          COUNT(*) FILTER (WHERE status='scheduled' AND scheduled_at >= now()) AS upcoming,
--          COUNT(*) FILTER (WHERE status='post')      AS final
--   FROM games GROUP BY sport_id ORDER BY sport_id;
--
-- Expected after apply: live_now drops sharply (esp. mlb from 17 to ~2-4
-- actual concurrent games); the rest move into 'final'.
