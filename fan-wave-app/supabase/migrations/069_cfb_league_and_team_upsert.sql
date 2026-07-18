-- 069: Add College Football league + enable ESPN team auto-upsert (v9.1)
--
-- v9.1 turns ESPN CFB on. FBS is ~134 programs -- too many to hand-seed via
-- a static migration and impossible to keep current as programs move
-- conferences. Instead, we let sync-game-schedules auto-upsert teams from
-- the ESPN scoreboard payload the first time it sees them. This is the
-- general answer for every future sport add (WNBA in v9.2, CBB later, etc.).
--
-- What this migration does:
--   1. Seed the College Football league row (sport already exists from
--      mig 007). The sync function looks it up by leagueName ILIKE match.
--   2. Add UNIQUE (league_id, name) on teams so the upsert-on-conflict
--      path from the edge function is race-safe.
--
-- The league row uses a deterministic UUID in the same b0000000 namespace
-- as mig 001, next slot after Premier League (007) = 008.
--
-- Idempotent -- safe to replay.

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000007',  -- College Football sport (mig 007)
   'College Football',
   'USA',
   '🏈')
ON CONFLICT (id) DO NOTHING;

-- Enforce uniqueness per league so the sync's INSERT ... ON CONFLICT
-- (league_id, name) DO UPDATE upsert is well-defined. Named constraint so
-- future migrations can reference it explicitly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teams_league_id_name_key'
  ) THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_league_id_name_key UNIQUE (league_id, name);
  END IF;
END $$;

-- Verify with:
--   SELECT id, name FROM public.leagues WHERE name = 'College Football';
--   SELECT conname FROM pg_constraint WHERE conname = 'teams_league_id_name_key';
