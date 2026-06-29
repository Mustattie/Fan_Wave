-- 064: Seed the WC 2026 nations that mig 006 missed.
--
-- Background:
-- Migration 006 seeded an early-projection group draw with 47 nations,
-- but the actual confirmed WC 2026 field includes 16 teams the seed
-- never had. On 2026-06-25 the production espn_sync_worldcup_fast cron
-- was returning successfully (HTTP 200) but `breakdown.worldcup.upserted`
-- stayed at 8 because every game involving a missing team was being
-- skipped at sync-game-schedules/index.ts:364 (`teamMap.get(name) ?? null`
-- returns null -> game pushed to unmatched_teams and `continue`d).
--
-- Symptom in the app: Soccer Cup Schedule jumped from Tue Jun 23 → Thu
-- Jun 25 with June 24 (final group-stage matchday for Groups A + B)
-- showing zero matches. After seeding these teams + waiting one cron
-- tick, day-by-day counts went 2/0/3/3/2 → 2/5/5/6/6/1 — every game
-- ESPN had for the window landed.
--
-- The `colors.group` values are best-guess from the 2026 draw; the sync
-- function does name-only matching, so corrections to `group` here are
-- purely cosmetic for the WCSchedule UI's group-badge.
--
-- Idempotent via ON CONFLICT DO NOTHING on (id) so replays are safe.

INSERT INTO teams (id, league_id, name, code, city, logo_url, colors) VALUES
  ('c0260000-0000-0000-0000-000000000048', 'b0000000-0000-0000-0000-000000000026', 'Bosnia-Herzegovina', 'BIH', 'Sarajevo',       NULL, '{"flag":"🇧🇦","confederation":"UEFA","group":"I"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000049', 'b0000000-0000-0000-0000-000000000026', 'Switzerland',        'SUI', 'Bern',           NULL, '{"flag":"🇨🇭","confederation":"UEFA","group":"C"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000050', 'b0000000-0000-0000-0000-000000000026', 'Haiti',              'HAI', 'Port-au-Prince', NULL, '{"flag":"🇭🇹","confederation":"CONCACAF","group":"F"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-000000000026', 'Scotland',           'SCO', 'Glasgow',        NULL, '{"flag":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","confederation":"UEFA","group":"D"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000052', 'b0000000-0000-0000-0000-000000000026', 'Czechia',            'CZE', 'Prague',         NULL, '{"flag":"🇨🇿","confederation":"UEFA","group":"B"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000053', 'b0000000-0000-0000-0000-000000000026', 'South Africa',       'RSA', 'Johannesburg',   NULL, '{"flag":"🇿🇦","confederation":"CAF","group":"F"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000054', 'b0000000-0000-0000-0000-000000000026', 'Curaçao',            'CUW', 'Willemstad',     NULL, '{"flag":"🇨🇼","confederation":"CONCACAF","group":"L"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000055', 'b0000000-0000-0000-0000-000000000026', 'Sweden',             'SWE', 'Stockholm',      NULL, '{"flag":"🇸🇪","confederation":"UEFA","group":"D"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000056', 'b0000000-0000-0000-0000-000000000026', 'Türkiye',            'TUR', 'Istanbul',       NULL, '{"flag":"🇹🇷","confederation":"UEFA","group":"A"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000057', 'b0000000-0000-0000-0000-000000000026', 'Norway',             'NOR', 'Oslo',           NULL, '{"flag":"🇳🇴","confederation":"UEFA","group":"E"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000058', 'b0000000-0000-0000-0000-000000000026', 'Croatia',            'CRO', 'Zagreb',         NULL, '{"flag":"🇭🇷","confederation":"UEFA","group":"H"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000059', 'b0000000-0000-0000-0000-000000000026', 'Cape Verde',         'CPV', 'Praia',          NULL, '{"flag":"🇨🇻","confederation":"CAF","group":"G"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000060', 'b0000000-0000-0000-0000-000000000026', 'Jordan',             'JOR', 'Amman',          NULL, '{"flag":"🇯🇴","confederation":"AFC","group":"J"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000061', 'b0000000-0000-0000-0000-000000000026', 'Austria',            'AUT', 'Vienna',         NULL, '{"flag":"🇦🇹","confederation":"UEFA","group":"K"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000062', 'b0000000-0000-0000-0000-000000000026', 'Congo DR',           'COD', 'Kinshasa',       NULL, '{"flag":"🇨🇩","confederation":"CAF","group":"B"}'::jsonb),
  ('c0260000-0000-0000-0000-000000000063', 'b0000000-0000-0000-0000-000000000026', 'Iraq',               'IRQ', 'Baghdad',        NULL, '{"flag":"🇮🇶","confederation":"AFC","group":"A"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
