-- ============================================================
-- Fan Wave — Seed Data for Live App Testing
-- Run via: supabase db execute --file supabase/seed.sql
-- ============================================================

-- =========================
--  Feature Flags
-- =========================

INSERT INTO feature_flags (key, enabled, start_date, end_date, config) VALUES
  ('world_cup_mode', true, '2026-06-11T00:00:00Z', '2026-07-19T23:59:59Z', '{"show_countdown": true}')
ON CONFLICT (key) DO NOTHING;

-- =========================
--  Events (Current Seasons)
-- =========================

INSERT INTO events (id, league_id, name, type, start_date, end_date, is_active) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'NFL 2025-26 Season',   'season', '2025-09-04', '2026-02-08', true),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'NBA 2025-26 Season',   'season', '2025-10-22', '2026-06-15', true),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'MLB 2026 Season',      'season', '2026-03-27', '2026-10-25', true),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'MLS 2026 Season',      'season', '2026-02-21', '2026-11-08', true),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'NHL 2025-26 Season',   'season', '2025-10-07', '2026-06-20', true)
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Helper: Get team IDs by code
--  (We'll reference teams by looking them up)
-- =========================

-- =========================
--  Games (Upcoming this week)
-- =========================

-- NBA games
INSERT INTO games (id, event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM teams WHERE code = 'DAL' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   (SELECT id FROM teams WHERE code = 'LAL' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   'American Airlines Center', 32.7905, -96.8103,
   '2026-04-07T01:30:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM teams WHERE code = 'CHI' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   (SELECT id FROM teams WHERE code = 'MIL' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   'United Center', 41.8807, -87.6742,
   '2026-04-08T00:00:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM teams WHERE code = 'BOS' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   (SELECT id FROM teams WHERE code = 'NYK' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   'TD Garden', 42.3662, -71.0621,
   '2026-04-08T23:30:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM teams WHERE code = 'MIA' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   (SELECT id FROM teams WHERE code = 'ATL' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   'Kaseya Center', 25.7814, -80.1870,
   '2026-04-09T23:30:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000002',
   (SELECT id FROM teams WHERE code = 'GSW' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   (SELECT id FROM teams WHERE code = 'DEN' AND league_id = 'b0000000-0000-0000-0000-000000000002'),
   'Chase Center', 37.7680, -122.3877,
   '2026-04-10T02:00:00Z', 'scheduled', 'Regular Season')
ON CONFLICT (id) DO NOTHING;

-- MLB games
INSERT INTO games (id, event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage) VALUES
  ('d0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000003',
   (SELECT id FROM teams WHERE code = 'NYY' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   (SELECT id FROM teams WHERE code = 'BOS' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   'Yankee Stadium', 40.8296, -73.9262,
   '2026-04-07T23:05:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000003',
   (SELECT id FROM teams WHERE code = 'LAD' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   (SELECT id FROM teams WHERE code = 'SF' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   'Dodger Stadium', 34.0739, -118.2400,
   '2026-04-08T02:10:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000003',
   (SELECT id FROM teams WHERE code = 'CHC' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   (SELECT id FROM teams WHERE code = 'STL' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   'Wrigley Field', 41.9484, -87.6553,
   '2026-04-09T00:20:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000013', 'e0000000-0000-0000-0000-000000000003',
   (SELECT id FROM teams WHERE code = 'TEX' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   (SELECT id FROM teams WHERE code = 'HOU' AND league_id = 'b0000000-0000-0000-0000-000000000003'),
   'Globe Life Field', 32.7473, -97.0845,
   '2026-04-09T00:05:00Z', 'scheduled', 'Regular Season')
ON CONFLICT (id) DO NOTHING;

-- MLS games
INSERT INTO games (id, event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage) VALUES
  ('d0000000-0000-0000-0000-000000000020', 'e0000000-0000-0000-0000-000000000004',
   (SELECT id FROM teams WHERE code = 'DAL' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   (SELECT id FROM teams WHERE code = 'MIA' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   'Toyota Stadium', 33.1545, -96.8353,
   '2026-04-11T00:30:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000004',
   (SELECT id FROM teams WHERE code = 'LAFC' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   (SELECT id FROM teams WHERE code = 'LA' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   'BMO Stadium', 34.0128, -118.2841,
   '2026-04-12T02:30:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000004',
   (SELECT id FROM teams WHERE code = 'ATL' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   (SELECT id FROM teams WHERE code = 'NYC' AND league_id = 'b0000000-0000-0000-0000-000000000004'),
   'Mercedes-Benz Stadium', 33.7553, -84.4006,
   '2026-04-11T23:30:00Z', 'scheduled', 'Regular Season')
ON CONFLICT (id) DO NOTHING;

-- NHL games
INSERT INTO games (id, event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage) VALUES
  ('d0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000005',
   (SELECT id FROM teams WHERE code = 'DAL' AND league_id = 'b0000000-0000-0000-0000-000000000005'),
   (SELECT id FROM teams WHERE code = 'COL' AND league_id = 'b0000000-0000-0000-0000-000000000005'),
   'American Airlines Center', 32.7905, -96.8103,
   '2026-04-08T00:00:00Z', 'scheduled', 'Regular Season'),

  ('d0000000-0000-0000-0000-000000000031', 'e0000000-0000-0000-0000-000000000005',
   (SELECT id FROM teams WHERE code = 'NYR' AND league_id = 'b0000000-0000-0000-0000-000000000005'),
   (SELECT id FROM teams WHERE code = 'BOS' AND league_id = 'b0000000-0000-0000-0000-000000000005'),
   'Madison Square Garden', 40.7505, -73.9934,
   '2026-04-09T23:00:00Z', 'scheduled', 'Regular Season')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Chat Rooms (Fan Groups)
-- =========================

-- Use a dummy owner_id (will be replaced when real users sign up)
-- The owner_id needs to be a UUID but doesn't need to reference auth

-- Dallas groups
INSERT INTO chat_rooms (id, name, description, group_type, sport_id, city, tags, visibility, owner_id, member_count, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Cowboys Nation Dallas', 'The biggest Cowboys fan group in DFW. Game day meetups, news, and hype.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Dallas', ARRAY['NFL', 'Dallas', 'Cowboys'], 'public',
   '00000000-0000-0000-0000-000000000001', 2847, now() - interval '90 days'),

  ('c0000000-0000-0000-0000-000000000002', 'Mavs Fanatics', 'Dallas Mavericks fans - game threads, trade talk, and watch parties.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Dallas', ARRAY['NBA', 'Dallas', 'Mavericks'], 'public',
   '00000000-0000-0000-0000-000000000001', 1523, now() - interval '60 days'),

  ('c0000000-0000-0000-0000-000000000003', 'FC Dallas Supporters', 'Official supporters group. Match day info, tifo, and tailgates.', 'sports',
   'a0000000-0000-0000-0000-000000000006', 'Dallas', ARRAY['MLS', 'Dallas', 'FC Dallas', 'Soccer'], 'public',
   '00000000-0000-0000-0000-000000000001', 687, now() - interval '45 days'),

  ('c0000000-0000-0000-0000-000000000004', 'Rangers Republic', 'Texas Rangers fans unite. Game updates and Arlington watch parties.', 'sports',
   'a0000000-0000-0000-0000-000000000003', 'Dallas', ARRAY['MLB', 'Dallas', 'Rangers'], 'public',
   '00000000-0000-0000-0000-000000000001', 1205, now() - interval '30 days'),

  ('c0000000-0000-0000-0000-000000000005', 'Stars Hockey Dallas', 'Dallas Stars fans - playoff push mode activated!', 'sports',
   'a0000000-0000-0000-0000-000000000005', 'Dallas', ARRAY['NHL', 'Dallas', 'Stars'], 'public',
   '00000000-0000-0000-0000-000000000001', 934, now() - interval '75 days'),

-- Chicago groups
  ('c0000000-0000-0000-0000-000000000010', 'Bears Fans Chicago', 'Da Bears! Chicago''s biggest Bears fan community.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Chicago', ARRAY['NFL', 'Chicago', 'Bears'], 'public',
   '00000000-0000-0000-0000-000000000001', 3241, now() - interval '120 days'),

  ('c0000000-0000-0000-0000-000000000011', 'Bulls Nation Chicago', 'Chicago Bulls fans. Game nights, highlights, and hoops talk.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Chicago', ARRAY['NBA', 'Chicago', 'Bulls'], 'public',
   '00000000-0000-0000-0000-000000000001', 1892, now() - interval '100 days'),

  ('c0000000-0000-0000-0000-000000000012', 'Cubs Faithful', 'Wrigley regulars and Cubs fans everywhere.', 'sports',
   'a0000000-0000-0000-0000-000000000003', 'Chicago', ARRAY['MLB', 'Chicago', 'Cubs'], 'public',
   '00000000-0000-0000-0000-000000000001', 2156, now() - interval '85 days'),

  ('c0000000-0000-0000-0000-000000000013', 'Eagles Fans in Chicago', 'Philly faithful living in Chicago. Watch parties every Sunday.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Chicago', ARRAY['NFL', 'Chicago', 'Eagles'], 'public',
   '00000000-0000-0000-0000-000000000001', 342, now() - interval '50 days'),

-- New York groups
  ('c0000000-0000-0000-0000-000000000020', 'Knicks City', 'New York Knicks fans - MSG energy all day.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'New York', ARRAY['NBA', 'New York', 'Knicks'], 'public',
   '00000000-0000-0000-0000-000000000001', 4521, now() - interval '150 days'),

  ('c0000000-0000-0000-0000-000000000021', 'Yankees Universe', 'All rise! Yankees fans worldwide.', 'sports',
   'a0000000-0000-0000-0000-000000000003', 'New York', ARRAY['MLB', 'New York', 'Yankees'], 'public',
   '00000000-0000-0000-0000-000000000001', 5102, now() - interval '180 days'),

  ('c0000000-0000-0000-0000-000000000022', 'Giants Blue Crew NYC', 'NY Giants fans. Big Blue forever.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'New York', ARRAY['NFL', 'New York', 'Giants'], 'public',
   '00000000-0000-0000-0000-000000000001', 1876, now() - interval '95 days'),

-- Los Angeles groups
  ('c0000000-0000-0000-0000-000000000030', 'Lakers Lounge LA', 'Showtime lives here. Lakers fans in LA and beyond.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Los Angeles', ARRAY['NBA', 'Los Angeles', 'Lakers'], 'public',
   '00000000-0000-0000-0000-000000000001', 6234, now() - interval '200 days'),

  ('c0000000-0000-0000-0000-000000000031', 'Dodgers Blue Heaven', 'LA Dodgers fans. Champs energy.', 'sports',
   'a0000000-0000-0000-0000-000000000003', 'Los Angeles', ARRAY['MLB', 'Los Angeles', 'Dodgers'], 'public',
   '00000000-0000-0000-0000-000000000001', 3891, now() - interval '160 days'),

  ('c0000000-0000-0000-0000-000000000032', 'LAFC Black & Gold', 'Los Angeles FC supporters. 3252 strong.', 'sports',
   'a0000000-0000-0000-0000-000000000006', 'Los Angeles', ARRAY['MLS', 'Los Angeles', 'LAFC', 'Soccer'], 'public',
   '00000000-0000-0000-0000-000000000001', 1456, now() - interval '70 days'),

-- Miami groups
  ('c0000000-0000-0000-0000-000000000040', 'Heat Culture Miami', 'Miami Heat fans. Culture runs deep.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Miami', ARRAY['NBA', 'Miami', 'Heat'], 'public',
   '00000000-0000-0000-0000-000000000001', 2789, now() - interval '130 days'),

  ('c0000000-0000-0000-0000-000000000041', 'Inter Miami Familia', 'Inter Miami CF fans. Heron vibes.', 'sports',
   'a0000000-0000-0000-0000-000000000006', 'Miami', ARRAY['MLS', 'Miami', 'Inter Miami', 'Soccer'], 'public',
   '00000000-0000-0000-0000-000000000001', 3456, now() - interval '110 days'),

  ('c0000000-0000-0000-0000-000000000042', 'Dolphins Fans Miami', 'Fins up! Miami Dolphins community.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Miami', ARRAY['NFL', 'Miami', 'Dolphins'], 'public',
   '00000000-0000-0000-0000-000000000001', 1987, now() - interval '140 days'),

-- Atlanta groups
  ('c0000000-0000-0000-0000-000000000050', 'Atlanta United Fans', 'ATL UTD! Five Stripes forever.', 'sports',
   'a0000000-0000-0000-0000-000000000006', 'Atlanta', ARRAY['MLS', 'Atlanta', 'Atlanta United', 'Soccer'], 'public',
   '00000000-0000-0000-0000-000000000001', 2345, now() - interval '165 days'),

  ('c0000000-0000-0000-0000-000000000051', 'Hawks Nest Atlanta', 'Atlanta Hawks fans. True to Atlanta.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Atlanta', ARRAY['NBA', 'Atlanta', 'Hawks'], 'public',
   '00000000-0000-0000-0000-000000000001', 1234, now() - interval '80 days'),

-- Houston groups
  ('c0000000-0000-0000-0000-000000000060', 'Texans Talk Houston', 'Houston Texans fans. H-Town hold it down.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Houston', ARRAY['NFL', 'Houston', 'Texans'], 'public',
   '00000000-0000-0000-0000-000000000001', 1678, now() - interval '55 days'),

  ('c0000000-0000-0000-0000-000000000061', 'Astros Nation Houston', 'Houston Astros fans. Space City baseball.', 'sports',
   'a0000000-0000-0000-0000-000000000003', 'Houston', ARRAY['MLB', 'Houston', 'Astros'], 'public',
   '00000000-0000-0000-0000-000000000001', 2901, now() - interval '170 days'),

-- Denver, Seattle, Boston, Philadelphia
  ('c0000000-0000-0000-0000-000000000070', 'Broncos Country Denver', 'Let''s ride! Denver Broncos fans.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Denver', ARRAY['NFL', 'Denver', 'Broncos'], 'public',
   '00000000-0000-0000-0000-000000000001', 1890, now() - interval '100 days'),

  ('c0000000-0000-0000-0000-000000000071', 'Nuggets Mile High', 'Denver Nuggets fans. Jokic MVP energy.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Denver', ARRAY['NBA', 'Denver', 'Nuggets'], 'public',
   '00000000-0000-0000-0000-000000000001', 1567, now() - interval '88 days'),

  ('c0000000-0000-0000-0000-000000000080', 'Seahawks 12s Seattle', 'The 12th Man. Seattle Seahawks fans.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Seattle', ARRAY['NFL', 'Seattle', 'Seahawks'], 'public',
   '00000000-0000-0000-0000-000000000001', 2234, now() - interval '115 days'),

  ('c0000000-0000-0000-0000-000000000081', 'Sounders FC Seattle', 'Seattle Sounders supporters. Rave green!', 'sports',
   'a0000000-0000-0000-0000-000000000006', 'Seattle', ARRAY['MLS', 'Seattle', 'Sounders', 'Soccer'], 'public',
   '00000000-0000-0000-0000-000000000001', 1345, now() - interval '92 days'),

  ('c0000000-0000-0000-0000-000000000090', 'Celtics Green Boston', 'Boston Celtics fans. Banner 18 champs!', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Boston', ARRAY['NBA', 'Boston', 'Celtics'], 'public',
   '00000000-0000-0000-0000-000000000001', 3678, now() - interval '190 days'),

  ('c0000000-0000-0000-0000-000000000091', 'Eagles Philly', 'Fly Eagles Fly! Philadelphia Eagles fans.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Philadelphia', ARRAY['NFL', 'Philadelphia', 'Eagles'], 'public',
   '00000000-0000-0000-0000-000000000001', 4123, now() - interval '175 days')

ON CONFLICT (id) DO NOTHING;

-- =========================
--  Watch Parties (Upcoming)
-- =========================

INSERT INTO watch_parties (id, creator_id, game_id, sport_id, title, description, venue_name, venue_address, venue_lat, venue_lon, venue_city, atmosphere, capacity, rsvp_count, starts_at) VALUES
-- Dallas watch parties
  ('f0000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000002',
   'Mavs vs Lakers Watch Party', 'Big screen, cold drinks, Mavs fans only energy!',
   'Trophy Room', '2513 Pacific Ave, Dallas, TX', 32.7876, -96.7985, 'Dallas',
   'rowdy', 80, 42, '2026-04-07T01:00:00Z'),

  ('f0000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000013',
   'a0000000-0000-0000-0000-000000000003',
   'Rangers vs Astros - Lone Star Showdown', 'I-45 rivalry watch party at the best sports bar in Deep Ellum.',
   'Happiest Hour', '2616 Olive St, Dallas, TX', 32.7890, -96.8010, 'Dallas',
   'loud', 60, 28, '2026-04-08T23:30:00Z'),

  ('f0000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000020',
   'a0000000-0000-0000-0000-000000000006',
   'FC Dallas vs Inter Miami Watch', 'Messi in town! Come watch with fellow supporters.',
   'Peticolas Brewing', '1301 Pace St, Dallas, TX', 32.7870, -96.8210, 'Dallas',
   'loud', 40, 35, '2026-04-11T00:00:00Z'),

  ('f0000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000030',
   'a0000000-0000-0000-0000-000000000005',
   'Stars vs Avalanche Playoff Push', 'Playoff race heating up! Watch with fellow Stars fans.',
   'Katy Trail Ice House', '3127 Routh St, Dallas, TX', 32.8020, -96.7980, 'Dallas',
   'moderate', 50, 19, '2026-04-07T23:30:00Z'),

-- Chicago watch parties
  ('f0000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002',
   'Bulls vs Bucks Watch Party', 'Bulls basketball at the best sports bar in South Loop.',
   'The Scout', '1301 S Wabash Ave, Chicago, IL', 41.8637, -87.6260, 'Chicago',
   'moderate', 30, 12, '2026-04-07T23:30:00Z'),

  ('f0000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000012',
   'a0000000-0000-0000-0000-000000000003',
   'Cubs vs Cardinals - Rivalry Night', 'Classic NL Central matchup at the best rooftop bar near Wrigley.',
   'Murphy''s Bleachers', '3655 N Sheffield Ave, Chicago, IL', 41.9482, -87.6555, 'Chicago',
   'rowdy', 100, 67, '2026-04-09T00:00:00Z'),

-- New York watch parties
  ('f0000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000002',
   'Celtics vs Knicks Watch Party', 'Eastern Conference showdown. MSG energy at the bar.',
   'Stout NYC', '133 W 33rd St, New York, NY', 40.7505, -73.9925, 'New York',
   'rowdy', 75, 58, '2026-04-08T23:00:00Z'),

  ('f0000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000010',
   'a0000000-0000-0000-0000-000000000003',
   'Yankees vs Red Sox Season Opener', 'The greatest rivalry in sports. Pinstripes only!',
   'Stan''s Sports Bar', '836 River Ave, Bronx, NY', 40.8280, -73.9260, 'New York',
   'rowdy', 120, 89, '2026-04-07T22:30:00Z'),

-- Los Angeles watch parties
  ('f0000000-0000-0000-0000-000000000030',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000005',
   'a0000000-0000-0000-0000-000000000002',
   'Warriors vs Nuggets Watch', 'West coast hoops. Chill vibes, big screen.',
   'Big Wangs', '1562 N Cahuenga Blvd, Los Angeles, CA', 34.0998, -118.3268, 'Los Angeles',
   'moderate', 45, 22, '2026-04-10T01:30:00Z'),

  ('f0000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000021',
   'a0000000-0000-0000-0000-000000000006',
   'El Trafico - LAFC vs Galaxy', 'The LA derby! Supporters section energy at the bar.',
   'The Greyhound Bar & Grill', '5570 W Pico Blvd, Los Angeles, CA', 34.0481, -118.3583, 'Los Angeles',
   'rowdy', 65, 52, '2026-04-12T02:00:00Z'),

-- Miami watch parties
  ('f0000000-0000-0000-0000-000000000040',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000002',
   'Heat vs Hawks Watch Night', 'Playoff positioning on the line. Heat culture only.',
   'Batch Gastropub', '30 SW 12th St, Miami, FL', 25.7650, -80.1940, 'Miami',
   'loud', 50, 31, '2026-04-09T23:00:00Z'),

-- Atlanta watch party
  ('f0000000-0000-0000-0000-000000000050',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000022',
   'a0000000-0000-0000-0000-000000000006',
   'Atlanta United vs NYCFC', 'Five Stripes watch party at the Benz!',
   'Brewhouse Cafe', '401 Ralph McGill Blvd, Atlanta, GA', 33.7580, -84.3750, 'Atlanta',
   'rowdy', 55, 38, '2026-04-11T23:00:00Z'),

-- Boston watch party
  ('f0000000-0000-0000-0000-000000000060',
   '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000002',
   'Celtics Watch at the Garden Bar', 'Banner 18 defense continues. Green runs deep.',
   'The Fours', '166 Canal St, Boston, MA', 42.3650, -71.0610, 'Boston',
   'rowdy', 90, 72, '2026-04-08T23:00:00Z')

ON CONFLICT (id) DO NOTHING;

-- =========================
--  Additional Fan Groups (San Francisco, Phoenix, Minneapolis, Toronto)
-- =========================

INSERT INTO chat_rooms (id, name, description, group_type, sport_id, city, tags, visibility, owner_id, member_count, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000100', '49ers Faithful SF', 'San Francisco 49ers fans. Faithful since day one.', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'San Francisco', ARRAY['NFL', 'San Francisco', '49ers'], 'public',
   '00000000-0000-0000-0000-000000000001', 3456, now() - interval '140 days'),
  ('c0000000-0000-0000-0000-000000000101', 'Warriors Dub Nation', 'Golden State Warriors fans. Strength in Numbers.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'San Francisco', ARRAY['NBA', 'San Francisco', 'Warriors'], 'public',
   '00000000-0000-0000-0000-000000000001', 4567, now() - interval '200 days'),
  ('c0000000-0000-0000-0000-000000000102', 'Suns Valley Phoenix', 'Phoenix Suns fans. Valley Boyz.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Phoenix', ARRAY['NBA', 'Phoenix', 'Suns'], 'public',
   '00000000-0000-0000-0000-000000000001', 1890, now() - interval '80 days'),
  ('c0000000-0000-0000-0000-000000000103', 'Cardinals Red Sea', 'Arizona Cardinals fans. Rise up Red Sea!', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Phoenix', ARRAY['NFL', 'Phoenix', 'Cardinals'], 'public',
   '00000000-0000-0000-0000-000000000001', 1234, now() - interval '65 days'),
  ('c0000000-0000-0000-0000-000000000104', 'Vikings Skol Minneapolis', 'Minnesota Vikings fans. SKOL!', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Minneapolis', ARRAY['NFL', 'Minneapolis', 'Vikings'], 'public',
   '00000000-0000-0000-0000-000000000001', 2100, now() - interval '95 days'),
  ('c0000000-0000-0000-0000-000000000105', 'Timberwolves Den', 'Minnesota Timberwolves fans. Ant-Man era.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Minneapolis', ARRAY['NBA', 'Minneapolis', 'Timberwolves'], 'public',
   '00000000-0000-0000-0000-000000000001', 1456, now() - interval '70 days'),
  ('c0000000-0000-0000-0000-000000000106', 'Raptors North Toronto', 'Toronto Raptors fans. We The North.', 'sports',
   'a0000000-0000-0000-0000-000000000002', 'Toronto', ARRAY['NBA', 'Toronto', 'Raptors'], 'public',
   '00000000-0000-0000-0000-000000000001', 2678, now() - interval '150 days'),
  ('c0000000-0000-0000-0000-000000000107', 'Maple Leafs Nation', 'Toronto Maple Leafs fans. Leafs forever.', 'sports',
   'a0000000-0000-0000-0000-000000000005', 'Toronto', ARRAY['NHL', 'Toronto', 'Maple Leafs'], 'public',
   '00000000-0000-0000-0000-000000000001', 3890, now() - interval '180 days'),
  ('c0000000-0000-0000-0000-000000000108', 'Packers Everywhere', 'Green Bay Packers fans across the country. Go Pack Go!', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Milwaukee', ARRAY['NFL', 'Milwaukee', 'Packers', 'Green Bay'], 'public',
   '00000000-0000-0000-0000-000000000001', 5678, now() - interval '210 days'),
  ('c0000000-0000-0000-0000-000000000109', 'Chiefs Kingdom KC', 'Kansas City Chiefs fans. Run it back!', 'sports',
   'a0000000-0000-0000-0000-000000000001', 'Kansas City', ARRAY['NFL', 'Kansas City', 'Chiefs'], 'public',
   '00000000-0000-0000-0000-000000000001', 4321, now() - interval '195 days'),
  ('c0000000-0000-0000-0000-000000000110', 'Away Fans Unite', 'Traveling to watch your team on the road? Find fans in any city.', 'sports',
   NULL, NULL, ARRAY['Travel', 'Away Fans', 'Road Trip'], 'public',
   '00000000-0000-0000-0000-000000000001', 1567, now() - interval '60 days'),
  ('c0000000-0000-0000-0000-000000000111', 'Sports Bar Crawl', 'Rating the best sports bars across America. City by city.', 'sports',
   NULL, NULL, ARRAY['Sports Bars', 'Reviews', 'Travel'], 'public',
   '00000000-0000-0000-0000-000000000001', 890, now() - interval '40 days')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Additional Watch Parties
-- =========================

INSERT INTO watch_parties (id, creator_id, game_id, sport_id, title, description, venue_name, venue_address, venue_lat, venue_lon, venue_city, atmosphere, capacity, rsvp_count, starts_at) VALUES
  ('f0000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002',
   'Warriors Watch at Chase Center Plaza', 'Outdoor big screen at Thrive City! Free to attend.',
   'Thrive City', '1 Warriors Way, San Francisco, CA', 37.7680, -122.3877, 'San Francisco',
   'rowdy', 200, 134, '2026-04-10T01:30:00Z'),
  ('f0000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000003',
   'Dodgers vs Giants Rivalry Watch', 'West coast baseball at its finest.',
   'MoMo''s', '760 2nd St, San Francisco, CA', 37.7787, -122.3892, 'San Francisco',
   'loud', 70, 48, '2026-04-08T01:30:00Z'),
  ('f0000000-0000-0000-0000-000000000080', '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000005',
   'Rangers vs Bruins at the Garden', 'Original Six rivalry!',
   'Blarney Rock Pub', '137 W 33rd St, New York, NY', 40.7500, -73.9920, 'New York',
   'rowdy', 85, 63, '2026-04-09T22:30:00Z'),
  ('f0000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000001',
   NULL, 'a0000000-0000-0000-0000-000000000001',
   'NFL Draft Watch Party 2026', 'Watch the NFL Draft together! Big screens, wings, and hot takes.',
   'Dave & Buster''s', '234 W 42nd St, New York, NY', 40.7565, -73.9878, 'New York',
   'loud', 150, 97, '2026-04-23T20:00:00Z'),
  ('f0000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002',
   'Heat Game Night - Wynwood', 'Watch Heat vs Hawks in the heart of Wynwood.',
   'Gramps', '176 NW 24th St, Miami, FL', 25.7960, -80.1950, 'Miami',
   'moderate', 40, 25, '2026-04-09T23:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Sample Messages (recent chat activity)
-- =========================

INSERT INTO messages (id, chat_room_id, user_id, content, type, created_at) VALUES
  ('m0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Who else is hyped for the draft? We NEED a corner.', 'text', now() - interval '2 hours'),
  ('m0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Draft party at Trophy Room anyone?', 'text', now() - interval '1 hour'),
  ('m0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Dak extension looking good. This is our year!', 'text', now() - interval '30 minutes'),
  ('m0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'MSG is going to be ELECTRIC tonight against Boston', 'text', now() - interval '3 hours'),
  ('m0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'Brunson dropping 40 tonight, book it', 'text', now() - interval '2 hours'),
  ('m0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'Anyone at Stout for the watch party? Place is packed!', 'text', now() - interval '45 minutes'),
  ('m0000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'LeBron legacy game incoming vs Dallas', 'text', now() - interval '4 hours'),
  ('m0000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'AD needs to dominate the boards tonight', 'text', now() - interval '3 hours'),
  ('m0000000-0000-0000-0000-000000000030', 'c0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Cards rivalry game this week! Who''s going to Wrigley?', 'text', now() - interval '5 hours'),
  ('m0000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Murphy''s Bleachers watch party is gonna be insane', 'text', now() - interval '1 hour'),
  ('m0000000-0000-0000-0000-000000000040', 'c0000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', 'Heat culture never dies. Playoff push starts NOW.', 'text', now() - interval '6 hours'),
  ('m0000000-0000-0000-0000-000000000041', 'c0000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', 'Bam triple-double watch tonight vs Hawks', 'text', now() - interval '2 hours'),
  ('m0000000-0000-0000-0000-000000000050', 'c0000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000001', 'Banner 18 defense starts with this Knicks game', 'text', now() - interval '3 hours'),
  ('m0000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000001', 'The Fours is the move for tonight. 72 RSVPs already!', 'text', now() - interval '1 hour'),
  ('m0000000-0000-0000-0000-000000000060', 'c0000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000001', 'Saquon + Hurts = unstoppable. Can''t wait for next season', 'text', now() - interval '8 hours'),
  ('m0000000-0000-0000-0000-000000000070', 'c0000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'Five Stripes hosting NYCFC this weekend. Tifo ready?', 'text', now() - interval '4 hours'),
  ('m0000000-0000-0000-0000-000000000080', 'c0000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Steph cooking tonight against Denver. Playoff mode activated!', 'text', now() - interval '2 hours'),
  ('m0000000-0000-0000-0000-000000000081', 'c0000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Thrive City outdoor watch party has 134 RSVPs!', 'text', now() - interval '30 minutes')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Sample Match Moments
-- =========================

INSERT INTO match_moments (id, chat_room_id, game_id, user_id, moment_type, comment, created_at) VALUES
  ('mm000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'three_pointer', 'LUKA FROM DEEP! Mavs up 12!', now() - interval '20 minutes'),
  ('mm000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'dunk', 'Kyrie with the POSTER! The bar just erupted!', now() - interval '15 minutes'),
  ('mm000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'reaction', 'This crowd energy at the watch party is insane', now() - interval '10 minutes'),
  ('mm000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'home_run', 'GONE! Cubs take the lead with a 3-run bomb!', now() - interval '3 hours'),
  ('mm000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'strikeout', 'Nasty slider to end the inning. Ace stuff.', now() - interval '2 hours'),
  ('mm000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000090', 'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'three_pointer', 'Tatum from the logo! 30-footer nothing but net!', now() - interval '1 hour'),
  ('mm000000-0000-0000-0000-000000000021', 'c0000000-0000-0000-0000-000000000090', 'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'block', 'GET THAT OUT OF HERE! Defensive masterclass!', now() - interval '45 minutes'),
  ('mm000000-0000-0000-0000-000000000030', 'c0000000-0000-0000-0000-000000000040', 'd0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'steal', 'Butler with the steal and coast-to-coast slam! Heat culture!', now() - interval '2 hours'),
  ('mm000000-0000-0000-0000-000000000040', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'goal', 'STARS SCORE! Power play goal to tie it up!', now() - interval '1 hour'),
  ('mm000000-0000-0000-0000-000000000050', 'c0000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'three_pointer', 'STEPH CURRY WITH THE SHOT! Night night!', now() - interval '30 minutes'),
  ('mm000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'reaction', 'Chase Center going absolutely NUTS right now', now() - interval '25 minutes')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Sample Moment Reactions
-- =========================

INSERT INTO moment_reactions (id, moment_id, user_id, emoji) VALUES
  ('mr000000-0000-0000-0000-000000000001', 'mm000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '🔥'),
  ('mr000000-0000-0000-0000-000000000002', 'mm000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '😱'),
  ('mr000000-0000-0000-0000-000000000003', 'mm000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '💪'),
  ('mr000000-0000-0000-0000-000000000004', 'mm000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', '🔥'),
  ('mr000000-0000-0000-0000-000000000005', 'mm000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', '😤'),
  ('mr000000-0000-0000-0000-000000000006', 'mm000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', '🏆'),
  ('mr000000-0000-0000-0000-000000000007', 'mm000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', '🔥'),
  ('mr000000-0000-0000-0000-000000000008', 'mm000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000001', '👏')
ON CONFLICT (id) DO NOTHING;

-- =========================
--  Sample Media Clips (across all sports)
-- =========================

INSERT INTO media_clips (id, chat_room_id, game_id, user_id, title, description, media_url, media_type, duration_seconds, view_count, like_count, created_at) VALUES
  -- NBA clips
  ('mc000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Luka step-back three', 'Luka with the signature step-back to put the Mavs up by 10', 'https://placeholder.fanwave.app/clips/luka-stepback.mp4', 'video', 18, 2340, 189, now() - interval '2 hours'),
  ('mc000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000020', 'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Brunson coast-to-coast', 'Jalen Brunson weaves through the entire Celtics defense', 'https://placeholder.fanwave.app/clips/brunson-drive.mp4', 'video', 22, 4560, 312, now() - interval '3 hours'),
  ('mc000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000030', 'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'AD block party', 'Anthony Davis with back-to-back blocks', 'https://placeholder.fanwave.app/clips/ad-blocks.mp4', 'video', 15, 1890, 145, now() - interval '4 hours'),
  ('mc000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000090', 'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Tatum logo three', 'Jayson Tatum drills it from the logo to silence MSG', 'https://placeholder.fanwave.app/clips/tatum-logo.mp4', 'video', 12, 5670, 423, now() - interval '1 hour'),
  ('mc000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Steph shimmy after three', 'Curry hits the dagger three and hits the shimmy. Night night.', 'https://placeholder.fanwave.app/clips/steph-shimmy.mp4', 'video', 20, 8900, 678, now() - interval '30 minutes'),
  ('mc000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000040', 'd0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Butler steal and slam', 'Jimmy Buckets coast to coast for the and-1', 'https://placeholder.fanwave.app/clips/butler-slam.mp4', 'video', 16, 3210, 234, now() - interval '2 hours'),
  -- MLB clips
  ('mc000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Cubs walk-off homer', '3-run walk-off bomb to beat the Cardinals. Wrigley goes CRAZY.', 'https://placeholder.fanwave.app/clips/cubs-walkoff.mp4', 'video', 30, 6780, 512, now() - interval '3 hours'),
  ('mc000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000021', 'd0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Judge 450-foot bomb', 'Aaron Judge DESTROYS this pitch. 450 feet to center.', 'https://placeholder.fanwave.app/clips/judge-bomb.mp4', 'video', 25, 7890, 567, now() - interval '5 hours'),
  -- NHL clips
  ('mc000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'Stars OT winner', 'Stars score in overtime! Playoff hockey is the best.', 'https://placeholder.fanwave.app/clips/stars-ot.mp4', 'video', 28, 3450, 278, now() - interval '1 hour'),
  -- MLS clips
  ('mc000000-0000-0000-0000-000000000030', 'c0000000-0000-0000-0000-000000000050', 'd0000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Atlanta United tifo reveal', 'Incredible tifo display by the supporters section.', 'https://placeholder.fanwave.app/clips/atl-tifo.mp4', 'video', 35, 4560, 345, now() - interval '4 hours'),
  ('mc000000-0000-0000-0000-000000000031', 'c0000000-0000-0000-0000-000000000032', 'd0000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'LAFC El Trafico goal', 'Screamer from 25 yards in the LA derby! The 3252 is shaking!', 'https://placeholder.fanwave.app/clips/lafc-eltrafico.mp4', 'video', 20, 5670, 456, now() - interval '2 hours'),
  -- Watch party atmosphere clips
  ('mc000000-0000-0000-0000-000000000040', 'c0000000-0000-0000-0000-000000000001', NULL, '00000000-0000-0000-0000-000000000001', 'Trophy Room erupts!', 'The whole bar going crazy after the Cowboys pick.', 'https://placeholder.fanwave.app/clips/cowboys-draft.mp4', 'video', 22, 3400, 267, now() - interval '6 hours'),
  ('mc000000-0000-0000-0000-000000000041', 'c0000000-0000-0000-0000-000000000020', NULL, '00000000-0000-0000-0000-000000000001', 'MSG watch party energy', 'Stout NYC packed wall-to-wall for the Knicks game.', 'https://placeholder.fanwave.app/clips/msg-energy.mp4', 'video', 18, 2890, 198, now() - interval '1 hour'),
  ('mc000000-0000-0000-0000-000000000042', 'c0000000-0000-0000-0000-000000000090', NULL, '00000000-0000-0000-0000-000000000001', 'Celtics fans take over The Fours', 'Banner 18 chants echoing through the bar.', 'https://placeholder.fanwave.app/clips/celtics-fours.mp4', 'video', 15, 2100, 156, now() - interval '45 minutes'),
  -- Image clips
  ('mc000000-0000-0000-0000-000000000050', 'c0000000-0000-0000-0000-000000000050', NULL, '00000000-0000-0000-0000-000000000001', 'Five Stripes tailgate setup', 'Pre-match tailgate at the Benz looking perfect.', 'https://placeholder.fanwave.app/clips/atl-tailgate.jpg', 'image', NULL, 1560, 112, now() - interval '5 hours'),
  ('mc000000-0000-0000-0000-000000000051', 'c0000000-0000-0000-0000-000000000040', NULL, '00000000-0000-0000-0000-000000000001', 'Heat culture wall at the bar', 'Batch Gastropub Heat culture wall setup for tonight.', 'https://placeholder.fanwave.app/clips/heat-culture.jpg', 'image', NULL, 980, 78, now() - interval '3 hours'),
  ('mc000000-0000-0000-0000-000000000052', 'c0000000-0000-0000-0000-000000000061', NULL, '00000000-0000-0000-0000-000000000001', 'Minute Maid sunset', 'Sunset over Minute Maid Park before first pitch. Beautiful.', 'https://placeholder.fanwave.app/clips/minutemaid-sunset.jpg', 'image', NULL, 2340, 189, now() - interval '7 hours')
ON CONFLICT (id) DO NOTHING;
