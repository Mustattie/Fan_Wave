-- 079: Ensure teams UNIQUE (league_id, name) constraint (v9.1.10)
--
-- WHY:
--   v9.1 UAT 2026-07-22 Test #11 diagnostic. sync-game-schedules edge
--   function returned per-sport breakdown:
--     mlb  → upserted=124, errors=[]
--     mls  → upserted=20,  errors=["team upsert: there is no unique or
--                                   exclusion constraint matching..."]
--     wnba → upserted=0,   errors=["team upsert: ..."],
--            unmatched_teams=["Los Angeles Sparks vs Phoenix Mercury (401857086)", ...]
--     nba/nfl/nhl/cbb/cfb/worldcup → upserted=0, errors=[] (all off-season)
--
--   The upsert uses .upsert(rows, { onConflict: "league_id,name" }) which
--   requires a UNIQUE constraint on (league_id, name) in the teams table.
--   Mig 069 was supposed to add teams_league_id_name_key with exactly that
--   shape, but either never applied to prod or applied with a different
--   name/definition. The 42P10 error message proves no matching constraint
--   is currently visible to PostgREST.
--
--   Effect: brand-new sports like WNBA (with zero pre-existing teams in the
--   DB) can never sync their first game because every team requires an
--   upsert, and every upsert fails. MLS got a partial pass because
--   pre-existing rows matched by global-name fallback and their games
--   inserted; new MLS teams from ESPN got skipped.
--
-- WHAT (idempotent):
--   Add the UNIQUE (league_id, name) constraint if it doesn't already
--   exist under any name. Check by predicate on the constraint's column
--   set rather than by name, since mig 069 might have applied under a
--   different name in some prior branch.

BEGIN;

DO $$
DECLARE
  has_constraint BOOLEAN;
BEGIN
  -- Does ANY unique constraint on teams cover exactly (league_id, name)?
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a1
        ON a1.attrelid = c.conrelid
       AND a1.attnum   = c.conkey[1]
      JOIN pg_attribute a2
        ON a2.attrelid = c.conrelid
       AND a2.attnum   = c.conkey[2]
     WHERE c.conrelid  = 'public.teams'::regclass
       AND c.contype   = 'u'
       AND array_length(c.conkey, 1) = 2
       AND (
             (a1.attname = 'league_id' AND a2.attname = 'name')
          OR (a1.attname = 'name'      AND a2.attname = 'league_id')
       )
  ) INTO has_constraint;

  IF NOT has_constraint THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_league_id_name_key UNIQUE (league_id, name);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.teams'::regclass
--      AND contype = 'u';
--   -- Expect a UNIQUE (league_id, name) row.
--
-- After this + re-invoke of the sync, expect WNBA breakdown to show
-- upserted > 0 (regular season is currently active) and unmatched_teams
-- to shrink to [].
