-- 039: team roster updates — franchise relocations + new expansion.
--
-- The seed in migration 001 captured the 2024 rosters of NFL/NBA/MLB/MLS/
-- NHL. ESPN's authoritative 2025-26 data diverged in three places. Each
-- divergence broke the live-data pipeline silently: sync-game-schedules
-- matches incoming games by ESPN's displayName against teams.name, so
-- games involving these franchises never insert. Updating in-place
-- preserves team_id across renames — existing follows, groups, RSVPs,
-- and watch_parties keep their links because they reference team_id,
-- not name.
--
-- 1. MLB: Oakland Athletics rebranded mid-relocation to "Athletics"
--    (no city prefix) for the 2024+ seasons.
-- 2. NHL: Arizona Coyotes relocated to Utah for 2024-25 (initially
--    "Utah Hockey Club"), rebranded to "Utah Mammoth" for 2025-26.
-- 3. MLS: San Diego FC joined the league as an expansion team for the
--    2025 season — never existed in the seed.

UPDATE teams
SET name = 'Athletics', code = 'ATH'
WHERE name = 'Oakland Athletics';

UPDATE teams
SET name = 'Utah Mammoth', code = 'UTAH'
WHERE name = 'Arizona Coyotes';

-- MLS league_id from migration 001
INSERT INTO teams (league_id, name, code, city, colors)
SELECT
  'b0000000-0000-0000-0000-000000000004',
  'San Diego FC',
  'SD',
  'San Diego',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM teams
  WHERE name = 'San Diego FC'
    AND league_id = 'b0000000-0000-0000-0000-000000000004'
);

-- After apply, re-fire the logo sync to populate logo_url for all three:
--   SELECT public.invoke_team_logo_sync();
--
-- Verify (expect zero rows):
--   SELECT name FROM teams
--   WHERE name IN ('Oakland Athletics', 'Arizona Coyotes');
--
--   SELECT l.name AS league, t.name AS team
--   FROM teams t JOIN leagues l ON l.id = t.league_id
--   WHERE t.logo_url IS NULL AND l.name IN ('NFL','NBA','MLB','MLS','NHL')
--   ORDER BY l.name, t.name;
