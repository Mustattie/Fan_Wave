-- 044: promote espn_id to top-level column + dedup + UNIQUE constraint.
--
-- Root cause of mass duplication:
--   sync-game-schedules matched existing rows by
--     (home_team_id, away_team_id, scheduled_at::date, event_id)
--   When event_id was missing or rotated (new season's events row,
--   league lookup race, etc.), the match silently failed and the
--   function took the else branch: INSERT a fresh row every cron tick.
--   .maybeSingle() also errors-out on multiple matches, the error is
--   destructured away (`const { data: existing }` — no error binding),
--   the function treats it as "not found" and INSERTs again.
--   Compounding: tens of thousands of duplicate rows accumulated.
--   Observed at the time of this migration:
--     mlb: 1720 rows for 138 unique games (~12x duplication)
--     nba:  281 rows for  12 unique games (~23x duplication)
--
-- Fix: use ESPN's globally-stable event id as the natural key. Promote
-- metadata->>'espn_id' to a top-level column, dedupe by it, add a
-- UNIQUE constraint so the database itself refuses duplicates from now
-- on, regardless of any future function bug.
--
-- FK tables that reference games.id (must be repointed before DELETE):
--   - watch_parties.game_id (no ON DELETE — default RESTRICT)
--   - match_moments.game_id (no ON DELETE — default RESTRICT)
--   - media_clips.game_id  (no ON DELETE — default RESTRICT)

-- ─── 1. Add column + backfill from metadata ──────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS espn_id TEXT;

UPDATE games
SET espn_id = metadata->>'espn_id'
WHERE espn_id IS NULL
  AND metadata ? 'espn_id'
  AND metadata->>'espn_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS games_espn_id_idx ON games (espn_id);

-- ─── 2. Pick the winner row per espn_id ──────────────────────────────
-- Preference order:
--   a) status: 'in' > 'post' > 'scheduled' (live data is most valuable)
--   b) has score recorded (in_score IS NOT NULL beats NULL)
--   c) lowest id (stable tiebreak)
-- This means a finished game's row with real scores wins over a stale
-- scheduled duplicate.
CREATE TEMP TABLE games_winners ON COMMIT DROP AS
SELECT DISTINCT ON (espn_id)
  espn_id,
  id AS winner_id
FROM games
WHERE espn_id IS NOT NULL
ORDER BY
  espn_id,
  CASE status
    WHEN 'in'        THEN 1
    WHEN 'post'      THEN 2
    WHEN 'scheduled' THEN 3
    ELSE 4
  END,
  CASE WHEN home_score IS NULL THEN 1 ELSE 0 END,
  id;

-- ─── 3. Repoint FK references from losers → winners ─────────────────
UPDATE watch_parties wp
SET game_id = w.winner_id
FROM games g
JOIN games_winners w ON w.espn_id = g.espn_id
WHERE wp.game_id = g.id
  AND g.id != w.winner_id;

UPDATE match_moments mm
SET game_id = w.winner_id
FROM games g
JOIN games_winners w ON w.espn_id = g.espn_id
WHERE mm.game_id = g.id
  AND g.id != w.winner_id;

UPDATE media_clips mc
SET game_id = w.winner_id
FROM games g
JOIN games_winners w ON w.espn_id = g.espn_id
WHERE mc.game_id = g.id
  AND g.id != w.winner_id;

-- ─── 4. Delete loser rows ────────────────────────────────────────────
DELETE FROM games g
USING games_winners w
WHERE g.espn_id = w.espn_id
  AND g.id != w.winner_id;

-- ─── 5. UNIQUE constraint — no more duplicates, ever ─────────────────
-- NULL espn_id is allowed (FIFA WC seed rows + ~14 other anomalies have
-- it null and that's fine — Postgres treats NULLs as distinct in UNIQUE
-- constraints by default, so they coexist).
ALTER TABLE games
  ADD CONSTRAINT games_espn_id_unique UNIQUE (espn_id);

-- ─── Verify ──────────────────────────────────────────────────────────
-- Expect total_rows ≈ unique_espn_ids per sport after this (MLB ~138,
-- NBA ~12, etc.) plus the WC seed rows that have null espn_id.
--
--   SELECT sport_id,
--          COUNT(*) AS total_rows,
--          COUNT(DISTINCT espn_id) FILTER (WHERE espn_id IS NOT NULL) AS unique_espn_ids
--   FROM games GROUP BY sport_id ORDER BY total_rows DESC;
