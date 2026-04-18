-- ============================================================
-- Fan Wave — World Cup 2026 Data Migration
-- 006_world_cup_2026.sql
--
-- Seeds: FIFA WC league, WC 2026 event, 48 national teams,
--        104 matches (72 group + 32 knockout), WC fan groups,
--        and WC watch parties into existing tables.
-- ============================================================

-- =========================
-- Fixed reference IDs
-- =========================
-- WC League:  b0000000-0000-0000-0000-000000000026
-- WC Event:   e0000000-0000-0000-0000-000000002026
-- WC Soccer:  a0000000-0000-0000-0000-000000000004  (from 001)
-- Team IDs:   c0260000-0000-0000-0000-000000000001..048

-- =========================
-- 1. FIFA World Cup League
-- =========================
INSERT INTO leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000026',
   'a0000000-0000-0000-0000-000000000004',
   'FIFA World Cup', 'International', '🏆');

-- =========================
-- 2. World Cup 2026 Event
-- =========================
INSERT INTO events (id, league_id, name, type, start_date, end_date, is_active) VALUES
  ('e0000000-0000-0000-0000-000000002026',
   'b0000000-0000-0000-0000-000000000026',
   'FIFA World Cup 2026', 'tournament', '2026-06-11', '2026-07-19', true);

-- =========================
-- 3. 48 National Teams
-- =========================
INSERT INTO teams (id, league_id, name, code, city, logo_url, colors) VALUES
  -- Group A
  ('c0260000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000026', 'United States',  'USA', 'Various',       NULL, '{"flag":"🇺🇸","confederation":"CONCACAF","group":"A"}'),
  ('c0260000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000026', 'Wales',          'WAL', 'Cardiff',       NULL, '{"flag":"🏴󠁧󠁢󠁷󠁬󠁳󠁿","confederation":"UEFA","group":"A"}'),
  ('c0260000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000026', 'Senegal',        'SEN', 'Dakar',         NULL, '{"flag":"🇸🇳","confederation":"CAF","group":"A"}'),
  ('c0260000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000026', 'Chile',          'CHI', 'Santiago',      NULL, '{"flag":"🇨🇱","confederation":"CONMEBOL","group":"A"}'),
  -- Group B
  ('c0260000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000026', 'Mexico',         'MEX', 'Mexico City',   NULL, '{"flag":"🇲🇽","confederation":"CONCACAF","group":"B"}'),
  ('c0260000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000026', 'Ecuador',        'ECU', 'Quito',         NULL, '{"flag":"🇪🇨","confederation":"CONMEBOL","group":"B"}'),
  ('c0260000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000026', 'Egypt',          'EGY', 'Cairo',         NULL, '{"flag":"🇪🇬","confederation":"CAF","group":"B"}'),
  ('c0260000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000026', 'Uzbekistan',     'UZB', 'Tashkent',      NULL, '{"flag":"🇺🇿","confederation":"AFC","group":"B"}'),
  -- Group C
  ('c0260000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000026', 'Canada',         'CAN', 'Various',       NULL, '{"flag":"🇨🇦","confederation":"CONCACAF","group":"C"}'),
  ('c0260000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000026', 'Netherlands',    'NED', 'Amsterdam',     NULL, '{"flag":"🇳🇱","confederation":"UEFA","group":"C"}'),
  ('c0260000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000026', 'Nigeria',        'NGA', 'Lagos',         NULL, '{"flag":"🇳🇬","confederation":"CAF","group":"C"}'),
  ('c0260000-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000026', 'New Zealand',    'NZL', 'Auckland',      NULL, '{"flag":"🇳🇿","confederation":"OFC","group":"C"}'),
  -- Group D
  ('c0260000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000026', 'Brazil',         'BRA', 'Various',       NULL, '{"flag":"🇧🇷","confederation":"CONMEBOL","group":"D"}'),
  ('c0260000-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000026', 'Japan',          'JPN', 'Tokyo',         NULL, '{"flag":"🇯🇵","confederation":"AFC","group":"D"}'),
  ('c0260000-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-000000000026', 'Serbia',         'SRB', 'Belgrade',      NULL, '{"flag":"🇷🇸","confederation":"UEFA","group":"D"}'),
  ('c0260000-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-000000000026', 'Costa Rica',     'CRC', 'San José',      NULL, '{"flag":"🇨🇷","confederation":"CONCACAF","group":"D"}'),
  -- Group E
  ('c0260000-0000-0000-0000-000000000017', 'b0000000-0000-0000-0000-000000000026', 'Argentina',      'ARG', 'Buenos Aires',  NULL, '{"flag":"🇦🇷","confederation":"CONMEBOL","group":"E"}'),
  ('c0260000-0000-0000-0000-000000000018', 'b0000000-0000-0000-0000-000000000026', 'Denmark',        'DEN', 'Copenhagen',    NULL, '{"flag":"🇩🇰","confederation":"UEFA","group":"E"}'),
  ('c0260000-0000-0000-0000-000000000019', 'b0000000-0000-0000-0000-000000000026', 'Australia',      'AUS', 'Sydney',        NULL, '{"flag":"🇦🇺","confederation":"AFC","group":"E"}'),
  ('c0260000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000026', 'Peru',           'PER', 'Lima',          NULL, '{"flag":"🇵🇪","confederation":"CONMEBOL","group":"E"}'),
  -- Group F
  ('c0260000-0000-0000-0000-000000000021', 'b0000000-0000-0000-0000-000000000026', 'France',         'FRA', 'Paris',         NULL, '{"flag":"🇫🇷","confederation":"UEFA","group":"F"}'),
  ('c0260000-0000-0000-0000-000000000022', 'b0000000-0000-0000-0000-000000000026', 'Colombia',       'COL', 'Bogotá',        NULL, '{"flag":"🇨🇴","confederation":"CONMEBOL","group":"F"}'),
  ('c0260000-0000-0000-0000-000000000023', 'b0000000-0000-0000-0000-000000000026', 'South Korea',    'KOR', 'Seoul',         NULL, '{"flag":"🇰🇷","confederation":"AFC","group":"F"}'),
  ('c0260000-0000-0000-0000-000000000024', 'b0000000-0000-0000-0000-000000000026', 'Morocco',        'MAR', 'Rabat',         NULL, '{"flag":"🇲🇦","confederation":"CAF","group":"F"}'),
  -- Group G
  ('c0260000-0000-0000-0000-000000000025', 'b0000000-0000-0000-0000-000000000026', 'England',        'ENG', 'London',        NULL, '{"flag":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","confederation":"UEFA","group":"G"}'),
  ('c0260000-0000-0000-0000-000000000026', 'b0000000-0000-0000-0000-000000000026', 'Uruguay',        'URU', 'Montevideo',    NULL, '{"flag":"🇺🇾","confederation":"CONMEBOL","group":"G"}'),
  ('c0260000-0000-0000-0000-000000000027', 'b0000000-0000-0000-0000-000000000026', 'Iran',           'IRN', 'Tehran',        NULL, '{"flag":"🇮🇷","confederation":"AFC","group":"G"}'),
  ('c0260000-0000-0000-0000-000000000028', 'b0000000-0000-0000-0000-000000000026', 'Jamaica',        'JAM', 'Kingston',      NULL, '{"flag":"🇯🇲","confederation":"CONCACAF","group":"G"}'),
  -- Group H
  ('c0260000-0000-0000-0000-000000000029', 'b0000000-0000-0000-0000-000000000026', 'Germany',        'GER', 'Berlin',        NULL, '{"flag":"🇩🇪","confederation":"UEFA","group":"H"}'),
  ('c0260000-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000026', 'Ghana',          'GHA', 'Accra',         NULL, '{"flag":"🇬🇭","confederation":"CAF","group":"H"}'),
  ('c0260000-0000-0000-0000-000000000031', 'b0000000-0000-0000-0000-000000000026', 'Paraguay',       'PAR', 'Asunción',      NULL, '{"flag":"🇵🇾","confederation":"CONMEBOL","group":"H"}'),
  ('c0260000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000026', 'Saudi Arabia',   'SAU', 'Riyadh',        NULL, '{"flag":"🇸🇦","confederation":"AFC","group":"H"}'),
  -- Group I
  ('c0260000-0000-0000-0000-000000000033', 'b0000000-0000-0000-0000-000000000026', 'Spain',          'ESP', 'Madrid',        NULL, '{"flag":"🇪🇸","confederation":"UEFA","group":"I"}'),
  ('c0260000-0000-0000-0000-000000000034', 'b0000000-0000-0000-0000-000000000026', 'Algeria',        'ALG', 'Algiers',       NULL, '{"flag":"🇩🇿","confederation":"CAF","group":"I"}'),
  ('c0260000-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-000000000026', 'Honduras',       'HON', 'Tegucigalpa',   NULL, '{"flag":"🇭🇳","confederation":"CONCACAF","group":"I"}'),
  ('c0260000-0000-0000-0000-000000000036', 'b0000000-0000-0000-0000-000000000026', 'Qatar',          'QAT', 'Doha',          NULL, '{"flag":"🇶🇦","confederation":"AFC","group":"I"}'),
  -- Group J
  ('c0260000-0000-0000-0000-000000000037', 'b0000000-0000-0000-0000-000000000026', 'Portugal',       'POR', 'Lisbon',        NULL, '{"flag":"🇵🇹","confederation":"UEFA","group":"J"}'),
  ('c0260000-0000-0000-0000-000000000038', 'b0000000-0000-0000-0000-000000000026', 'Cameroon',       'CMR', 'Yaoundé',       NULL, '{"flag":"🇨🇲","confederation":"CAF","group":"J"}'),
  ('c0260000-0000-0000-0000-000000000039', 'b0000000-0000-0000-0000-000000000026', 'Panama',         'PAN', 'Panama City',   NULL, '{"flag":"🇵🇦","confederation":"CONCACAF","group":"J"}'),
  ('c0260000-0000-0000-0000-000000000040', 'b0000000-0000-0000-0000-000000000026', 'China',          'CHN', 'Beijing',       NULL, '{"flag":"🇨🇳","confederation":"AFC","group":"J"}'),
  -- Group K
  ('c0260000-0000-0000-0000-000000000041', 'b0000000-0000-0000-0000-000000000026', 'Belgium',        'BEL', 'Brussels',      NULL, '{"flag":"🇧🇪","confederation":"UEFA","group":"K"}'),
  ('c0260000-0000-0000-0000-000000000042', 'b0000000-0000-0000-0000-000000000026', 'Tunisia',        'TUN', 'Tunis',         NULL, '{"flag":"🇹🇳","confederation":"CAF","group":"K"}'),
  ('c0260000-0000-0000-0000-000000000043', 'b0000000-0000-0000-0000-000000000026', 'Venezuela',      'VEN', 'Caracas',       NULL, '{"flag":"🇻🇪","confederation":"CONMEBOL","group":"K"}'),
  ('c0260000-0000-0000-0000-000000000044', 'b0000000-0000-0000-0000-000000000026', 'India',          'IND', 'New Delhi',     NULL, '{"flag":"🇮🇳","confederation":"AFC","group":"K"}'),
  -- Group L
  ('c0260000-0000-0000-0000-000000000045', 'b0000000-0000-0000-0000-000000000026', 'Italy',          'ITA', 'Rome',          NULL, '{"flag":"🇮🇹","confederation":"UEFA","group":"L"}'),
  ('c0260000-0000-0000-0000-000000000046', 'b0000000-0000-0000-0000-000000000026', 'Ivory Coast',    'CIV', 'Abidjan',       NULL, '{"flag":"🇨🇮","confederation":"CAF","group":"L"}'),
  ('c0260000-0000-0000-0000-000000000047', 'b0000000-0000-0000-0000-000000000026', 'Bolivia',        'BOL', 'La Paz',        NULL, '{"flag":"🇧🇴","confederation":"CONMEBOL","group":"L"}'),
  ('c0260000-0000-0000-0000-000000000048', 'b0000000-0000-0000-0000-000000000026', 'Thailand',       'THA', 'Bangkok',       NULL, '{"flag":"🇹🇭","confederation":"AFC","group":"L"}');


-- =========================
-- 4. Group Stage Matches (72 games) — generated algorithmically
-- =========================
DO $$
DECLARE
  wc_event_id UUID := 'e0000000-0000-0000-0000-000000002026';

  -- 48 team IDs in group order (A1,A2,A3,A4, B1,B2,B3,B4, ... L1,L2,L3,L4)
  team_ids UUID[] := ARRAY[
    'c0260000-0000-0000-0000-000000000001','c0260000-0000-0000-0000-000000000002','c0260000-0000-0000-0000-000000000003','c0260000-0000-0000-0000-000000000004',
    'c0260000-0000-0000-0000-000000000005','c0260000-0000-0000-0000-000000000006','c0260000-0000-0000-0000-000000000007','c0260000-0000-0000-0000-000000000008',
    'c0260000-0000-0000-0000-000000000009','c0260000-0000-0000-0000-000000000010','c0260000-0000-0000-0000-000000000011','c0260000-0000-0000-0000-000000000012',
    'c0260000-0000-0000-0000-000000000013','c0260000-0000-0000-0000-000000000014','c0260000-0000-0000-0000-000000000015','c0260000-0000-0000-0000-000000000016',
    'c0260000-0000-0000-0000-000000000017','c0260000-0000-0000-0000-000000000018','c0260000-0000-0000-0000-000000000019','c0260000-0000-0000-0000-000000000020',
    'c0260000-0000-0000-0000-000000000021','c0260000-0000-0000-0000-000000000022','c0260000-0000-0000-0000-000000000023','c0260000-0000-0000-0000-000000000024',
    'c0260000-0000-0000-0000-000000000025','c0260000-0000-0000-0000-000000000026','c0260000-0000-0000-0000-000000000027','c0260000-0000-0000-0000-000000000028',
    'c0260000-0000-0000-0000-000000000029','c0260000-0000-0000-0000-000000000030','c0260000-0000-0000-0000-000000000031','c0260000-0000-0000-0000-000000000032',
    'c0260000-0000-0000-0000-000000000033','c0260000-0000-0000-0000-000000000034','c0260000-0000-0000-0000-000000000035','c0260000-0000-0000-0000-000000000036',
    'c0260000-0000-0000-0000-000000000037','c0260000-0000-0000-0000-000000000038','c0260000-0000-0000-0000-000000000039','c0260000-0000-0000-0000-000000000040',
    'c0260000-0000-0000-0000-000000000041','c0260000-0000-0000-0000-000000000042','c0260000-0000-0000-0000-000000000043','c0260000-0000-0000-0000-000000000044',
    'c0260000-0000-0000-0000-000000000045','c0260000-0000-0000-0000-000000000046','c0260000-0000-0000-0000-000000000047','c0260000-0000-0000-0000-000000000048'
  ];

  -- 16 venues
  v_names  TEXT[]  := ARRAY['MetLife Stadium','SoFi Stadium','AT&T Stadium','Hard Rock Stadium','NRG Stadium','Lumen Field','Lincoln Financial Field','Gillette Stadium','Mercedes-Benz Stadium','Arrowhead Stadium','Levi''s Stadium','BMO Field','BC Place','Estadio Azteca','Estadio Akron','Estadio BBVA'];
  v_lats   FLOAT[] := ARRAY[40.8128,33.9535,32.7473,25.958,29.6847,47.5952,39.9008,42.0909,33.7553,39.0489,37.4033,43.6332,49.2768,19.3029,20.6809,25.6669];
  v_lons   FLOAT[] := ARRAY[-74.0742,-118.3392,-97.0945,-80.2389,-95.4107,-122.3316,-75.1675,-71.2643,-84.401,-94.484,-121.9694,-79.4186,-123.112,-99.1505,-103.4625,-100.2447];
  v_cities TEXT[]  := ARRAY['East Rutherford, NJ','Los Angeles, CA','Dallas, TX','Miami, FL','Houston, TX','Seattle, WA','Philadelphia, PA','Foxborough, MA','Atlanta, GA','Kansas City, MO','Santa Clara, CA','Toronto, ON','Vancouver, BC','Mexico City','Guadalajara','Monterrey'];

  -- Groups
  groups TEXT[] := ARRAY['A','B','C','D','E','F','G','H','I','J','K','L'];

  -- Round-robin pairings (0-indexed within each group of 4)
  pair_h INT[] := ARRAY[0,2,0,1,0,1];
  pair_a INT[] := ARRAY[1,3,2,3,3,2];

  -- Match times (UTC — roughly afternoon/evening in North America)
  times TIME[] := ARRAY['17:00'::TIME,'20:00'::TIME,'23:00'::TIME,'02:00'::TIME];

  gi      INT;   -- group index 0..11
  pi      INT;   -- pairing index 0..5
  gidx    INT := 0; -- global match index
  d_off   INT;
  t_slot  INT;
  v_idx   INT;
  h_id    UUID;
  a_id    UUID;
  m_date  DATE;
BEGIN
  FOR gi IN 0..11 LOOP
    FOR pi IN 0..5 LOOP
      d_off  := gidx / 4;
      t_slot := (gidx % 4) + 1;       -- 1-indexed for PG arrays
      v_idx  := (gidx % 16) + 1;

      h_id   := team_ids[(gi * 4) + pair_h[pi + 1] + 1];
      a_id   := team_ids[(gi * 4) + pair_a[pi + 1] + 1];
      m_date := '2026-06-11'::DATE + d_off;

      INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
      VALUES (
        wc_event_id,
        h_id,
        a_id,
        v_names[v_idx],
        v_lats[v_idx],
        v_lons[v_idx],
        (m_date + times[t_slot])::TIMESTAMPTZ,
        'scheduled',
        'group',
        jsonb_build_object(
          'match_number', gidx + 1,
          'group', groups[gi + 1],
          'venue_city', v_cities[v_idx]
        )
      );

      gidx := gidx + 1;
    END LOOP;
  END LOOP;
END $$;


-- =========================
-- 5. Knockout Stage Matches (32 games) — TBD teams
-- =========================
DO $$
DECLARE
  wc_event_id UUID := 'e0000000-0000-0000-0000-000000002026';
  v_names  TEXT[]  := ARRAY['MetLife Stadium','SoFi Stadium','AT&T Stadium','Hard Rock Stadium','NRG Stadium','Lumen Field','Lincoln Financial Field','Gillette Stadium','Mercedes-Benz Stadium','Arrowhead Stadium','Levi''s Stadium','BMO Field','BC Place','Estadio Azteca','Estadio Akron','Estadio BBVA'];
  v_lats   FLOAT[] := ARRAY[40.8128,33.9535,32.7473,25.958,29.6847,47.5952,39.9008,42.0909,33.7553,39.0489,37.4033,43.6332,49.2768,19.3029,20.6809,25.6669];
  v_lons   FLOAT[] := ARRAY[-74.0742,-118.3392,-97.0945,-80.2389,-95.4107,-122.3316,-75.1675,-71.2643,-84.401,-94.484,-121.9694,-79.4186,-123.112,-99.1505,-103.4625,-100.2447];
  times    TIME[] := ARRAY['17:00'::TIME,'20:00'::TIME,'23:00'::TIME,'02:00'::TIME];

  -- Round of 32 placeholder labels
  r32_home TEXT[] := ARRAY['Winner A','Winner B','Winner C','Winner D','Winner E','Winner F','Winner G','Winner H','Winner I','Winner J','Winner K','Winner L','2nd Place A','2nd Place B','2nd Place C','2nd Place D'];
  r32_away TEXT[] := ARRAY['3rd C/D/E','3rd A/B/F','3rd D/E/F','3rd A/B/C','3rd I/J/K','3rd G/H/L','3rd J/K/L','3rd G/H/I','Runner-up E','Runner-up F','Runner-up G','Runner-up H','Runner-up I','Runner-up J','Runner-up K','Runner-up L'];

  i       INT;
  d_off   INT;
  t_slot  INT;
  v_idx   INT;
  m_date  DATE;
  mn      INT := 73;  -- match numbers continue from group stage
BEGIN
  -- Round of 32: 16 matches, July 2-5
  FOR i IN 0..15 LOOP
    d_off  := i / 4;
    t_slot := (i % 4) + 1;
    v_idx  := (i % 16) + 1;
    m_date := '2026-07-02'::DATE + d_off;

    INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
    VALUES (
      wc_event_id, NULL, NULL,
      v_names[v_idx], v_lats[v_idx], v_lons[v_idx],
      (m_date + times[t_slot])::TIMESTAMPTZ,
      'scheduled', 'round_of_32',
      jsonb_build_object('match_number', mn, 'home_placeholder', r32_home[i+1], 'away_placeholder', r32_away[i+1])
    );
    mn := mn + 1;
  END LOOP;

  -- Round of 16: 8 matches, July 7-8
  FOR i IN 0..7 LOOP
    d_off  := i / 4;
    t_slot := (i % 4) + 1;
    v_idx  := (i % 8) + 1;
    m_date := '2026-07-07'::DATE + d_off;

    INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
    VALUES (
      wc_event_id, NULL, NULL,
      v_names[v_idx], v_lats[v_idx], v_lons[v_idx],
      (m_date + times[t_slot])::TIMESTAMPTZ,
      'scheduled', 'round_of_16',
      jsonb_build_object('match_number', mn, 'home_placeholder', 'Winner R32-' || (i*2+1), 'away_placeholder', 'Winner R32-' || (i*2+2))
    );
    mn := mn + 1;
  END LOOP;

  -- Quarter-finals: 4 matches, July 11-12
  FOR i IN 0..3 LOOP
    d_off  := i / 2;
    t_slot := CASE WHEN (i % 2) = 0 THEN 1 ELSE 2 END;
    v_idx  := i + 1;
    m_date := '2026-07-11'::DATE + d_off;

    INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
    VALUES (
      wc_event_id, NULL, NULL,
      v_names[v_idx], v_lats[v_idx], v_lons[v_idx],
      (m_date + times[t_slot])::TIMESTAMPTZ,
      'scheduled', 'quarter_final',
      jsonb_build_object('match_number', mn, 'home_placeholder', 'Winner R16-' || (i*2+1), 'away_placeholder', 'Winner R16-' || (i*2+2))
    );
    mn := mn + 1;
  END LOOP;

  -- Semi-finals: 2 matches, July 15
  FOR i IN 0..1 LOOP
    t_slot := CASE WHEN i = 0 THEN 1 ELSE 2 END;
    v_idx  := CASE WHEN i = 0 THEN 1 ELSE 2 END;

    INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
    VALUES (
      wc_event_id, NULL, NULL,
      v_names[v_idx], v_lats[v_idx], v_lons[v_idx],
      ('2026-07-15'::DATE + times[t_slot])::TIMESTAMPTZ,
      'scheduled', 'semi_final',
      jsonb_build_object('match_number', mn, 'home_placeholder', 'Winner QF-' || (i*2+1), 'away_placeholder', 'Winner QF-' || (i*2+2))
    );
    mn := mn + 1;
  END LOOP;

  -- Third-place match: July 18
  INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
  VALUES (
    wc_event_id, NULL, NULL,
    'Hard Rock Stadium', 25.958, -80.2389,
    '2026-07-18T20:00:00Z'::TIMESTAMPTZ,
    'scheduled', 'third_place',
    jsonb_build_object('match_number', mn, 'home_placeholder', 'Loser SF-1', 'away_placeholder', 'Loser SF-2')
  );
  mn := mn + 1;

  -- Final: July 19
  INSERT INTO games (event_id, home_team_id, away_team_id, venue_name, venue_lat, venue_lon, scheduled_at, status, stage, metadata)
  VALUES (
    wc_event_id, NULL, NULL,
    'MetLife Stadium', 40.8128, -74.0742,
    '2026-07-19T20:00:00Z'::TIMESTAMPTZ,
    'scheduled', 'final',
    jsonb_build_object('match_number', mn, 'home_placeholder', 'Winner SF-1', 'away_placeholder', 'Winner SF-2')
  );
END $$;


-- =========================
-- 6. World Cup Fan Groups (chat_rooms)
-- =========================
-- Uses a system placeholder owner_id (will be claimed by first admin)
INSERT INTO chat_rooms (id, name, description, group_type, sport_id, event_id, city, tags, visibility, owner_id, member_count, avatar_url) VALUES
  ('f0260000-0000-0000-0000-000000000001', 'USA Fans 🇺🇸',         'The official community for US Soccer fans heading into the 2026 World Cup on home soil!',                   'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','USA','USMNT'],                 'public', '00000000-0000-0000-0000-000000000000', 12450, NULL),
  ('f0260000-0000-0000-0000-000000000002', 'Mexico Fans 🇲🇽',       'Vamos El Tri! Connect with fellow Mexico supporters for WC 2026.',                                          'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','Mexico','El Tri'],              'public', '00000000-0000-0000-0000-000000000000', 9830,  NULL),
  ('f0260000-0000-0000-0000-000000000003', 'Brazil Fans 🇧🇷',       'Samba, goals, and glory. Join the biggest Brazil fan community for WC 2026.',                                'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','Brazil','Selecao'],             'public', '00000000-0000-0000-0000-000000000000', 15200, NULL),
  ('f0260000-0000-0000-0000-000000000004', 'Argentina Fans 🇦🇷',    'Defending champions! Join Argentina fans for WC 2026.',                                                      'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','Argentina','Albiceleste'],      'public', '00000000-0000-0000-0000-000000000000', 14100, NULL),
  ('f0260000-0000-0000-0000-000000000005', 'England Fans 🏴󠁧󠁢󠁥󠁮󠁧󠁿',   'Three Lions on the shirt! Follow England''s journey at WC 2026.',                                        'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','England','Three Lions'],        'public', '00000000-0000-0000-0000-000000000000', 8740,  NULL),
  ('f0260000-0000-0000-0000-000000000006', 'France Fans 🇫🇷',       'Allez les Bleus! Join the France fan community for WC 2026.',                                                'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', NULL,           ARRAY['World Cup','France','Les Bleus'],           'public', '00000000-0000-0000-0000-000000000000', 7650,  NULL),
  ('f0260000-0000-0000-0000-000000000007', 'Traveling to Dallas ✈️', 'Coordinating travel, accommodation, and fan meetups in Dallas for WC 2026 matches.',                         'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', 'Dallas',       ARRAY['World Cup','Dallas','Travel'],              'public', '00000000-0000-0000-0000-000000000000', 3200,  NULL),
  ('f0260000-0000-0000-0000-000000000008', 'NYC World Cup Hub 🗽',   'Everything WC 2026 in New York: watch parties, fan zones, travel tips, and more.',                            'worldcup', 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026', 'New York',     ARRAY['World Cup','New York','Hub'],               'public', '00000000-0000-0000-0000-000000000000', 5870,  NULL);


-- =========================
-- 7. World Cup Watch Parties
-- =========================
INSERT INTO watch_parties (id, creator_id, game_id, sport_id, event_id, title, description, venue_name, venue_address, venue_lat, venue_lon, venue_city, atmosphere, capacity, rsvp_count, starts_at) VALUES
  ('f0260000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', NULL, 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026',
   'USA vs Wales Opening Match Party',     'Watch the opening match on the big screen!',   'The Football Factory',    '99 3rd Ave, New York, NY',       40.731, -73.989,  'New York',     'loud',    150, 87,  '2026-06-11T00:00:00Z'),
  ('f0260000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', NULL, 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026',
   'Mexico vs Ecuador Watch Party',         'Vamos Mexico! Join us at Estadio Bar.',       'Estadio Bar & Grill',     '700 S Flower St, Los Angeles, CA', 34.045, -118.263, 'Los Angeles',  'loud',    100, 64,  '2026-06-11T20:00:00Z'),
  ('f0260000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000', NULL, 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026',
   'Brazil vs Japan Viewing',               'Samba vibes in South Beach.',                 'Samba Sports Lounge',     '820 Ocean Dr, Miami, FL',         25.782, -80.131,  'Miami',        'loud',    200, 112, '2026-06-14T00:00:00Z'),
  ('f0260000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000', NULL, 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026',
   'England vs Uruguay Big Screen',         'Pub vibes for the Three Lions.',              'The Pitch Sports Bar',    '1234 N Milwaukee Ave, Chicago, IL', 41.906, -87.669, 'Chicago',      'moderate', 80,  45,  '2026-06-12T22:00:00Z'),
  ('f0260000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000000', NULL, 'a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000002026',
   'USA vs Chile at AT&T Stadium',          'Watch from the official fan zone!',           'AT&T Stadium Fan Zone',   '1 AT&T Way, Arlington, TX',       32.747, -97.095,  'Dallas',       'rowdy',   500, 230, '2026-06-12T17:00:00Z');
