-- 075: WNBA sport + WNBA/CBB league seeds (v9.1.4)
--
-- WHY:
--   v9.1 UAT 2026-07-21: founder asked "I do not see WNBA and College
--   football, basketball why?" Discover's pill row was hardcoded to 5
--   sports (NFL/NBA/Soccer/MLB/NHL) despite constants/Sports.ts having
--   9. The frontend fix (v9.1.4 client) rewires Discover to derive pills
--   from the SPORTS constant AND adds WNBA to it. But WNBA still won't
--   surface any games or auto-suggest fan groups until:
--     1. A sports row exists for WNBA so chat_rooms.sport_id can point
--        at it and games rows can join to it.
--     2. A leagues row exists so sync-game-schedules can look it up
--        (leagueName ILIKE match) and start pulling ESPN payloads.
--
--   Same story for College Basketball: mig 007 seeded the sport row but
--   never created a leagues row, so the sync map entry v9.1.4 added would
--   fall through the join.
--
-- WHAT (idempotent, safe to replay):
--   1. Seed WNBA sport (a0000000-...-000000000009) if missing.
--   2. Seed WNBA league (b0000000-...-000000000009) pointing at the WNBA
--      sport row.
--   3. Seed College Basketball league (b0000000-...-00000000000a) pointing
--      at the existing CBB sport row from mig 007.
--
-- Team auto-upsert works via the teams_league_id_name_key UNIQUE constraint
-- mig 069 already added; sync-game-schedules INSERTs teams ON CONFLICT
-- (league_id, name) DO UPDATE the first time it sees them in an ESPN
-- payload. No hand-seeded team rows needed.

INSERT INTO public.sports (id, name, icon, color) VALUES
  ('a0000000-0000-0000-0000-000000000009', 'WNBA', '🏀', '#ff6b35')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000009',
   'a0000000-0000-0000-0000-000000000009',  -- WNBA sport
   'WNBA',
   'USA',
   '🏀'),
  ('b0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-000000000008',  -- College Basketball sport (mig 007)
   'College Basketball',
   'USA',
   '🏀')
ON CONFLICT (id) DO NOTHING;

-- Verify with:
--   SELECT id, name FROM public.sports WHERE name = 'WNBA';
--   SELECT id, name, sport_id FROM public.leagues
--    WHERE name IN ('WNBA', 'College Basketball')
--    ORDER BY name;
