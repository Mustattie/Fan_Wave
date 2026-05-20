-- 031: store sport id (nfl/nba/mlb/mls/nhl/...) directly on games so the
-- client doesn't have to drill into team→league→sport to figure out
-- which per-sport branch to render in GameCard's period label. Without
-- this, MLB games showed "Q1" instead of "Top 2nd" because the JOIN
-- depth meant sport_name resolved to empty string.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS sport_id TEXT;

CREATE INDEX IF NOT EXISTS games_sport_id_idx ON games (sport_id);

-- Backfill existing rows from their associated league → sport mapping
-- so the column isn't NULL for the seeded historical games. The ESPN
-- sync function will set it directly on new inserts/updates going
-- forward (lowercased league code).
UPDATE games g
SET sport_id = lower(l.name)
FROM events e
JOIN leagues l ON l.id = e.league_id
WHERE g.event_id = e.id AND g.sport_id IS NULL;
