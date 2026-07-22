-- 078: Backfill WNBA + College Football league rows at unused UUIDs (v9.1.8)
--
-- WHY:
--   v9.1 UAT 2026-07-22 continued diagnostic after mig 077. Full leagues
--   inventory shows both target UUIDs are pre-occupied:
--     UUID b0000000-...-000000000008 → "NCAA D1"  (sport_id = CBB)
--     UUID b0000000-...-000000000009 → "UFC"      (sport_id = UFC)
--     UUID b0000000-...-00000000000a → "College Basketball" (mig 075 landed here)
--   Neither mig 069 (CFB) nor mig 075 (WNBA) league insert ever landed
--   because their target UUIDs were already occupied by earlier seeds --
--   ON CONFLICT DO NOTHING silently swallowed both misses.
--
--   sync-game-schedules maps cfb → leagueName 'College Football' and
--   wnba → 'WNBA'. Without matching leagues rows, ESPN games synced for
--   those sports never resolve an event_id and get dropped from the join.
--   Explains Test #11 zero games for CFB / WNBA / CBB.
--
-- WHAT:
--   Insert WNBA + CFB league rows at fresh UUIDs 00b and 00c respectively
--   (confirmed free per the 11-row b0000000 namespace scan). Both point
--   at the correct sport_id (WNBA sport from mig 077, CFB sport from mig
--   007). Idempotent.
--
-- Deploy note: no changes to sync-game-schedules required -- it looks up
-- leagues by leagueName ILIKE match, not by UUID. As long as a row
-- exists with name='WNBA' or name='College Football', the sync stamps
-- event_id correctly regardless of which UUID the row uses.

BEGIN;

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-00000000000b',
   'a0000000-0000-0000-0000-00000000000a',  -- WNBA sport (mig 077)
   'WNBA', 'USA', '🏀'),
  ('b0000000-0000-0000-0000-00000000000c',
   'a0000000-0000-0000-0000-000000000007',  -- College Football sport (mig 007)
   'College Football', 'USA', '🏈')
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT l.id, l.name AS league, s.name AS sport
--     FROM public.leagues l
--     JOIN public.sports  s ON s.id = l.sport_id
--    WHERE l.name IN ('WNBA', 'College Football', 'College Basketball')
--    ORDER BY l.name;
--   -- expect 3 rows, sport column matches league name for each
