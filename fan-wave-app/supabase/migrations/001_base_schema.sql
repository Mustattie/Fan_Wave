-- ============================================================
-- Fan Wave — Base Schema Migration
-- 001_base_schema.sql
-- ============================================================

-- =========================
--  TABLES
-- =========================

CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id          UUID UNIQUE,
  display_name     TEXT,
  avatar_url       TEXT,
  home_city        TEXT,
  favorite_team_ids UUID[] DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sports (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  icon  TEXT,
  color TEXT
);

CREATE TABLE leagues (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id UUID REFERENCES sports (id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  country  TEXT,
  icon     TEXT
);

CREATE TABLE teams (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID REFERENCES leagues (id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  code      TEXT,
  city      TEXT,
  logo_url  TEXT,
  colors    JSONB DEFAULT '{}'
);

CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID REFERENCES leagues (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT CHECK (type IN ('season', 'tournament', 'playoff')),
  start_date DATE,
  end_date   DATE,
  is_active  BOOLEAN DEFAULT false
);

CREATE TABLE games (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID REFERENCES events (id) ON DELETE CASCADE,
  home_team_id  UUID REFERENCES teams (id),
  away_team_id  UUID REFERENCES teams (id),
  venue_name    TEXT,
  venue_lat     FLOAT,
  venue_lon     FLOAT,
  scheduled_at  TIMESTAMPTZ,
  status        TEXT DEFAULT 'scheduled',
  home_score    INT,
  away_score    INT,
  stage         TEXT,
  metadata      JSONB DEFAULT '{}'
);

CREATE TABLE feature_flags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT UNIQUE NOT NULL,
  enabled    BOOLEAN DEFAULT false,
  start_date TIMESTAMPTZ,
  end_date   TIMESTAMPTZ,
  config     JSONB DEFAULT '{}'
);

-- =========================
--  ROW-LEVEL SECURITY
-- =========================

ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- Public SELECT for everyone
-- Users can read their own profile
CREATE POLICY "Users read own profile" ON users FOR SELECT TO authenticated USING (auth_id = auth.uid());
-- Users can insert their own profile
CREATE POLICY "Users insert own profile" ON users FOR INSERT TO authenticated WITH CHECK (auth_id = auth.uid());
-- Users can update their own profile
CREATE POLICY "Users update own profile" ON users FOR UPDATE TO authenticated USING (auth_id = auth.uid()) WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Public read sports"        ON sports        FOR SELECT USING (true);
CREATE POLICY "Public read leagues"       ON leagues       FOR SELECT USING (true);
CREATE POLICY "Public read teams"         ON teams         FOR SELECT USING (true);
CREATE POLICY "Public read events"        ON events        FOR SELECT USING (true);
CREATE POLICY "Public read games"         ON games         FOR SELECT USING (true);
CREATE POLICY "Public read feature_flags" ON feature_flags FOR SELECT USING (true);

-- INSERT restricted to service_role
CREATE POLICY "Service insert sports"        ON sports        FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert leagues"       ON leagues       FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert teams"         ON teams         FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert events"        ON events        FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert games"         ON games         FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert feature_flags" ON feature_flags FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- UPDATE restricted to service_role
CREATE POLICY "Service update sports"        ON sports        FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update leagues"       ON leagues       FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update teams"         ON teams         FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update events"        ON events        FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update games"         ON games         FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update feature_flags" ON feature_flags FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- DELETE restricted to service_role
CREATE POLICY "Service delete sports"        ON sports        FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete leagues"       ON leagues       FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete teams"         ON teams         FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete events"        ON events        FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete games"         ON games         FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete feature_flags" ON feature_flags FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- ============================================================
--  SEED DATA
-- ============================================================

-- =========================
--  Sports
-- =========================

INSERT INTO sports (id, name, icon, color) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'NFL',    '🏈', '#0096ff'),
  ('a0000000-0000-0000-0000-000000000002', 'NBA',    '🏀', '#ff8c00'),
  ('a0000000-0000-0000-0000-000000000003', 'MLB',    '⚾', '#cc0000'),
  ('a0000000-0000-0000-0000-000000000004', 'Soccer', '⚽', '#00c853'),
  ('a0000000-0000-0000-0000-000000000005', 'NHL',    '🏒', '#000080'),
  ('a0000000-0000-0000-0000-000000000006', 'MLS',    '⚽', '#006400');

-- =========================
--  Leagues
-- =========================

INSERT INTO leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NFL',             'USA',     '🏈'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'NBA',             'USA',     '🏀'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'MLB',             'USA',     '⚾'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000006', 'MLS',             'USA',     '⚽'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'NHL',             'USA',     '🏒'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000004', 'Liga MX',         'Mexico',  '⚽'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000004', 'Premier League',  'England', '⚽');

-- =========================
--  Teams — NFL (32)
-- =========================

INSERT INTO teams (league_id, name, code, city, colors) VALUES
  -- AFC East
  ('b0000000-0000-0000-0000-000000000001', 'Buffalo Bills',        'BUF', 'Buffalo',       '{"primary":"#00338D","secondary":"#C60C30"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Miami Dolphins',       'MIA', 'Miami',         '{"primary":"#008E97","secondary":"#FC4C02"}'),
  ('b0000000-0000-0000-0000-000000000001', 'New England Patriots', 'NE',  'Foxborough',    '{"primary":"#002244","secondary":"#C60C30"}'),
  ('b0000000-0000-0000-0000-000000000001', 'New York Jets',        'NYJ', 'New York',      '{"primary":"#125740","secondary":"#FFFFFF"}'),
  -- AFC North
  ('b0000000-0000-0000-0000-000000000001', 'Baltimore Ravens',     'BAL', 'Baltimore',     '{"primary":"#241773","secondary":"#9E7C0C"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Cincinnati Bengals',   'CIN', 'Cincinnati',    '{"primary":"#FB4F14","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Cleveland Browns',     'CLE', 'Cleveland',     '{"primary":"#311D00","secondary":"#FF3C00"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Pittsburgh Steelers',  'PIT', 'Pittsburgh',    '{"primary":"#FFB612","secondary":"#101820"}'),
  -- AFC South
  ('b0000000-0000-0000-0000-000000000001', 'Houston Texans',       'HOU', 'Houston',       '{"primary":"#03202F","secondary":"#A71930"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Indianapolis Colts',   'IND', 'Indianapolis',  '{"primary":"#002C5F","secondary":"#A2AAAD"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Jacksonville Jaguars', 'JAX', 'Jacksonville',  '{"primary":"#006778","secondary":"#D7A22A"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Tennessee Titans',     'TEN', 'Nashville',     '{"primary":"#0C2340","secondary":"#4B92DB"}'),
  -- AFC West
  ('b0000000-0000-0000-0000-000000000001', 'Denver Broncos',       'DEN', 'Denver',        '{"primary":"#FB4F14","secondary":"#002244"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Kansas City Chiefs',   'KC',  'Kansas City',   '{"primary":"#E31837","secondary":"#FFB81C"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Las Vegas Raiders',    'LV',  'Las Vegas',     '{"primary":"#000000","secondary":"#A5ACAF"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Los Angeles Chargers', 'LAC', 'Los Angeles',   '{"primary":"#0080C6","secondary":"#FFC20E"}'),
  -- NFC East
  ('b0000000-0000-0000-0000-000000000001', 'Dallas Cowboys',          'DAL', 'Dallas',        '{"primary":"#003594","secondary":"#869397"}'),
  ('b0000000-0000-0000-0000-000000000001', 'New York Giants',         'NYG', 'New York',      '{"primary":"#0B2265","secondary":"#A71930"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Philadelphia Eagles',     'PHI', 'Philadelphia',  '{"primary":"#004C54","secondary":"#A5ACAF"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Washington Commanders',   'WAS', 'Washington',    '{"primary":"#5A1414","secondary":"#FFB612"}'),
  -- NFC North
  ('b0000000-0000-0000-0000-000000000001', 'Chicago Bears',           'CHI', 'Chicago',       '{"primary":"#0B162A","secondary":"#C83803"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Detroit Lions',           'DET', 'Detroit',       '{"primary":"#0076B6","secondary":"#B0B7BC"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Green Bay Packers',       'GB',  'Green Bay',     '{"primary":"#203731","secondary":"#FFB612"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Minnesota Vikings',       'MIN', 'Minneapolis',   '{"primary":"#4F2683","secondary":"#FFC62F"}'),
  -- NFC South
  ('b0000000-0000-0000-0000-000000000001', 'Atlanta Falcons',         'ATL', 'Atlanta',       '{"primary":"#A71930","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Carolina Panthers',       'CAR', 'Charlotte',     '{"primary":"#0085CA","secondary":"#101820"}'),
  ('b0000000-0000-0000-0000-000000000001', 'New Orleans Saints',      'NO',  'New Orleans',   '{"primary":"#D3BC8D","secondary":"#101820"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Tampa Bay Buccaneers',    'TB',  'Tampa Bay',     '{"primary":"#D50A0A","secondary":"#34302B"}'),
  -- NFC West
  ('b0000000-0000-0000-0000-000000000001', 'Arizona Cardinals',       'ARI', 'Phoenix',       '{"primary":"#97233F","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Los Angeles Rams',        'LAR', 'Los Angeles',   '{"primary":"#003594","secondary":"#FFA300"}'),
  ('b0000000-0000-0000-0000-000000000001', 'San Francisco 49ers',     'SF',  'San Francisco', '{"primary":"#AA0000","secondary":"#B3995D"}'),
  ('b0000000-0000-0000-0000-000000000001', 'Seattle Seahawks',        'SEA', 'Seattle',       '{"primary":"#002244","secondary":"#69BE28"}');

-- =========================
--  Teams — NBA (30)
-- =========================

INSERT INTO teams (league_id, name, code, city, colors) VALUES
  -- Atlantic
  ('b0000000-0000-0000-0000-000000000002', 'Boston Celtics',         'BOS', 'Boston',        '{"primary":"#007A33","secondary":"#BA9653"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Brooklyn Nets',          'BKN', 'Brooklyn',      '{"primary":"#000000","secondary":"#FFFFFF"}'),
  ('b0000000-0000-0000-0000-000000000002', 'New York Knicks',        'NYK', 'New York',      '{"primary":"#006BB6","secondary":"#F58426"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Philadelphia 76ers',     'PHI', 'Philadelphia',  '{"primary":"#006BB6","secondary":"#ED174C"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Toronto Raptors',        'TOR', 'Toronto',       '{"primary":"#CE1141","secondary":"#000000"}'),
  -- Central
  ('b0000000-0000-0000-0000-000000000002', 'Chicago Bulls',          'CHI', 'Chicago',       '{"primary":"#CE1141","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Cleveland Cavaliers',    'CLE', 'Cleveland',     '{"primary":"#860038","secondary":"#FDBB30"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Detroit Pistons',        'DET', 'Detroit',       '{"primary":"#C8102E","secondary":"#1D42BA"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Indiana Pacers',         'IND', 'Indianapolis',  '{"primary":"#002D62","secondary":"#FDBB30"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Milwaukee Bucks',        'MIL', 'Milwaukee',     '{"primary":"#00471B","secondary":"#EEE1C6"}'),
  -- Southeast
  ('b0000000-0000-0000-0000-000000000002', 'Atlanta Hawks',          'ATL', 'Atlanta',       '{"primary":"#E03A3E","secondary":"#C1D32F"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Charlotte Hornets',      'CHA', 'Charlotte',     '{"primary":"#1D1160","secondary":"#00788C"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Miami Heat',             'MIA', 'Miami',         '{"primary":"#98002E","secondary":"#F9A01B"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Orlando Magic',          'ORL', 'Orlando',       '{"primary":"#0077C0","secondary":"#C4CED4"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Washington Wizards',     'WAS', 'Washington',    '{"primary":"#002B5C","secondary":"#E31837"}'),
  -- Northwest
  ('b0000000-0000-0000-0000-000000000002', 'Denver Nuggets',         'DEN', 'Denver',        '{"primary":"#0E2240","secondary":"#FEC524"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Minnesota Timberwolves', 'MIN', 'Minneapolis',   '{"primary":"#0C2340","secondary":"#236192"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Oklahoma City Thunder',  'OKC', 'Oklahoma City', '{"primary":"#007AC1","secondary":"#EF6100"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Portland Trail Blazers', 'POR', 'Portland',      '{"primary":"#E03A3E","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Utah Jazz',              'UTA', 'Salt Lake City','{"primary":"#002B5C","secondary":"#F9A01B"}'),
  -- Pacific
  ('b0000000-0000-0000-0000-000000000002', 'Golden State Warriors',  'GSW', 'San Francisco', '{"primary":"#1D428A","secondary":"#FFC72C"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Los Angeles Clippers',   'LAC', 'Los Angeles',   '{"primary":"#C8102E","secondary":"#1D428A"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Los Angeles Lakers',     'LAL', 'Los Angeles',   '{"primary":"#552583","secondary":"#FDB927"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Phoenix Suns',           'PHX', 'Phoenix',       '{"primary":"#1D1160","secondary":"#E56020"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Sacramento Kings',       'SAC', 'Sacramento',    '{"primary":"#5A2D81","secondary":"#63727A"}'),
  -- Southwest
  ('b0000000-0000-0000-0000-000000000002', 'Dallas Mavericks',       'DAL', 'Dallas',        '{"primary":"#00538C","secondary":"#002B5E"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Houston Rockets',        'HOU', 'Houston',       '{"primary":"#CE1141","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000002', 'Memphis Grizzlies',      'MEM', 'Memphis',       '{"primary":"#5D76A9","secondary":"#12173F"}'),
  ('b0000000-0000-0000-0000-000000000002', 'New Orleans Pelicans',   'NOP', 'New Orleans',   '{"primary":"#0C2340","secondary":"#C8102E"}'),
  ('b0000000-0000-0000-0000-000000000002', 'San Antonio Spurs',      'SAS', 'San Antonio',   '{"primary":"#C4CED4","secondary":"#000000"}');

-- =========================
--  Teams — MLB (30)
-- =========================

INSERT INTO teams (league_id, name, code, city, colors) VALUES
  -- AL East
  ('b0000000-0000-0000-0000-000000000003', 'Baltimore Orioles',      'BAL', 'Baltimore',     '{"primary":"#DF4601","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Boston Red Sox',          'BOS', 'Boston',        '{"primary":"#BD3039","secondary":"#0C2340"}'),
  ('b0000000-0000-0000-0000-000000000003', 'New York Yankees',        'NYY', 'New York',      '{"primary":"#003087","secondary":"#E4002C"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Tampa Bay Rays',          'TB',  'St. Petersburg','{"primary":"#092C5C","secondary":"#8FBCE6"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Toronto Blue Jays',       'TOR', 'Toronto',       '{"primary":"#134A8E","secondary":"#1D2D5C"}'),
  -- AL Central
  ('b0000000-0000-0000-0000-000000000003', 'Chicago White Sox',       'CWS', 'Chicago',       '{"primary":"#27251F","secondary":"#C4CED4"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Cleveland Guardians',     'CLE', 'Cleveland',     '{"primary":"#00385D","secondary":"#E31937"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Detroit Tigers',          'DET', 'Detroit',       '{"primary":"#0C2340","secondary":"#FA4616"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Kansas City Royals',      'KC',  'Kansas City',   '{"primary":"#004687","secondary":"#BD9B60"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Minnesota Twins',         'MIN', 'Minneapolis',   '{"primary":"#002B5C","secondary":"#D31145"}'),
  -- AL West
  ('b0000000-0000-0000-0000-000000000003', 'Houston Astros',          'HOU', 'Houston',       '{"primary":"#002D62","secondary":"#EB6E1F"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Los Angeles Angels',      'LAA', 'Anaheim',       '{"primary":"#BA0021","secondary":"#003263"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Oakland Athletics',       'OAK', 'Sacramento',    '{"primary":"#003831","secondary":"#EFB21E"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Seattle Mariners',        'SEA', 'Seattle',       '{"primary":"#0C2C56","secondary":"#005C5C"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Texas Rangers',           'TEX', 'Arlington',     '{"primary":"#003278","secondary":"#C0111F"}'),
  -- NL East
  ('b0000000-0000-0000-0000-000000000003', 'Atlanta Braves',          'ATL', 'Atlanta',       '{"primary":"#CE1141","secondary":"#13274F"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Miami Marlins',           'MIA', 'Miami',         '{"primary":"#00A3E0","secondary":"#EF3340"}'),
  ('b0000000-0000-0000-0000-000000000003', 'New York Mets',           'NYM', 'New York',      '{"primary":"#002D72","secondary":"#FF5910"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Philadelphia Phillies',   'PHI', 'Philadelphia',  '{"primary":"#E81828","secondary":"#002D72"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Washington Nationals',    'WSH', 'Washington',    '{"primary":"#AB0003","secondary":"#14225A"}'),
  -- NL Central
  ('b0000000-0000-0000-0000-000000000003', 'Chicago Cubs',            'CHC', 'Chicago',       '{"primary":"#0E3386","secondary":"#CC3433"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Cincinnati Reds',         'CIN', 'Cincinnati',    '{"primary":"#C6011F","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Milwaukee Brewers',       'MIL', 'Milwaukee',     '{"primary":"#FFC52F","secondary":"#12284B"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Pittsburgh Pirates',      'PIT', 'Pittsburgh',    '{"primary":"#27251F","secondary":"#FDB827"}'),
  ('b0000000-0000-0000-0000-000000000003', 'St. Louis Cardinals',     'STL', 'St. Louis',     '{"primary":"#C41E3A","secondary":"#0C2340"}'),
  -- NL West
  ('b0000000-0000-0000-0000-000000000003', 'Arizona Diamondbacks',    'ARI', 'Phoenix',       '{"primary":"#A71930","secondary":"#E3D4AD"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Colorado Rockies',        'COL', 'Denver',        '{"primary":"#33006F","secondary":"#C4CED4"}'),
  ('b0000000-0000-0000-0000-000000000003', 'Los Angeles Dodgers',     'LAD', 'Los Angeles',   '{"primary":"#005A9C","secondary":"#EF3E42"}'),
  ('b0000000-0000-0000-0000-000000000003', 'San Diego Padres',        'SD',  'San Diego',     '{"primary":"#2F241D","secondary":"#FFC425"}'),
  ('b0000000-0000-0000-0000-000000000003', 'San Francisco Giants',    'SF',  'San Francisco', '{"primary":"#FD5A1E","secondary":"#27251F"}');

-- =========================
--  Teams — MLS (29)
-- =========================

INSERT INTO teams (league_id, name, code, city, colors) VALUES
  ('b0000000-0000-0000-0000-000000000004', 'Atlanta United FC',          'ATL', 'Atlanta',        '{"primary":"#80000B","secondary":"#221F1F"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Austin FC',                  'ATX', 'Austin',         '{"primary":"#00B140","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Charlotte FC',               'CLT', 'Charlotte',      '{"primary":"#1A85C8","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Chicago Fire FC',            'CHI', 'Chicago',        '{"primary":"#FF0000","secondary":"#0A174A"}'),
  ('b0000000-0000-0000-0000-000000000004', 'FC Cincinnati',              'CIN', 'Cincinnati',     '{"primary":"#F05323","secondary":"#263B80"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Colorado Rapids',            'COL', 'Commerce City',  '{"primary":"#960A2C","secondary":"#9CC2EA"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Columbus Crew',              'CLB', 'Columbus',       '{"primary":"#000000","secondary":"#FEDD00"}'),
  ('b0000000-0000-0000-0000-000000000004', 'D.C. United',                'DC',  'Washington',     '{"primary":"#000000","secondary":"#EF3E42"}'),
  ('b0000000-0000-0000-0000-000000000004', 'FC Dallas',                  'DAL', 'Frisco',         '{"primary":"#BF0D3E","secondary":"#002D68"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Houston Dynamo FC',          'HOU', 'Houston',        '{"primary":"#F68712","secondary":"#101820"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Inter Miami CF',             'MIA', 'Fort Lauderdale','{"primary":"#F7B5CD","secondary":"#231F20"}'),
  ('b0000000-0000-0000-0000-000000000004', 'LA Galaxy',                  'LA',  'Carson',         '{"primary":"#00245D","secondary":"#FFD200"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Los Angeles FC',             'LAFC','Los Angeles',    '{"primary":"#C39E6D","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Minnesota United FC',        'MIN', 'Saint Paul',     '{"primary":"#E4E5E6","secondary":"#231F20"}'),
  ('b0000000-0000-0000-0000-000000000004', 'CF Montreal',                'MTL', 'Montreal',       '{"primary":"#000000","secondary":"#0033A1"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Nashville SC',               'NSH', 'Nashville',      '{"primary":"#ECE83A","secondary":"#1F1646"}'),
  ('b0000000-0000-0000-0000-000000000004', 'New England Revolution',     'NE',  'Foxborough',     '{"primary":"#0A2240","secondary":"#CE0E2D"}'),
  ('b0000000-0000-0000-0000-000000000004', 'New York City FC',           'NYC', 'New York',       '{"primary":"#6CACE4","secondary":"#041E42"}'),
  ('b0000000-0000-0000-0000-000000000004', 'New York Red Bulls',         'RBNY','Harrison',       '{"primary":"#ED1E36","secondary":"#27251F"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Orlando City SC',            'ORL', 'Orlando',        '{"primary":"#633492","secondary":"#FDE192"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Philadelphia Union',         'PHI', 'Chester',        '{"primary":"#002D55","secondary":"#B18F2B"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Portland Timbers',           'POR', 'Portland',       '{"primary":"#004812","secondary":"#D69F0E"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Real Salt Lake',             'RSL', 'Sandy',          '{"primary":"#B30838","secondary":"#013A81"}'),
  ('b0000000-0000-0000-0000-000000000004', 'San Jose Earthquakes',       'SJ',  'San Jose',       '{"primary":"#0067B1","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Seattle Sounders FC',        'SEA', 'Seattle',        '{"primary":"#005695","secondary":"#658D1B"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Sporting Kansas City',       'SKC', 'Kansas City',    '{"primary":"#002F65","secondary":"#93B1D7"}'),
  ('b0000000-0000-0000-0000-000000000004', 'St. Louis City SC',          'STL', 'St. Louis',      '{"primary":"#D22630","secondary":"#0A1E2C"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Toronto FC',                 'TOR', 'Toronto',        '{"primary":"#E31937","secondary":"#455560"}'),
  ('b0000000-0000-0000-0000-000000000004', 'Vancouver Whitecaps FC',     'VAN', 'Vancouver',      '{"primary":"#00245E","secondary":"#9DC2EA"}');

-- =========================
--  Teams — NHL (32)
-- =========================

INSERT INTO teams (league_id, name, code, city, colors) VALUES
  -- Atlantic
  ('b0000000-0000-0000-0000-000000000005', 'Boston Bruins',            'BOS', 'Boston',        '{"primary":"#FFB81C","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Buffalo Sabres',           'BUF', 'Buffalo',       '{"primary":"#002654","secondary":"#FCB514"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Detroit Red Wings',        'DET', 'Detroit',       '{"primary":"#CE1126","secondary":"#FFFFFF"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Florida Panthers',         'FLA', 'Sunrise',       '{"primary":"#041E42","secondary":"#C8102E"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Montreal Canadiens',       'MTL', 'Montreal',      '{"primary":"#AF1E2D","secondary":"#192168"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Ottawa Senators',          'OTT', 'Ottawa',        '{"primary":"#C52032","secondary":"#C2912C"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Tampa Bay Lightning',      'TBL', 'Tampa',         '{"primary":"#002868","secondary":"#FFFFFF"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Toronto Maple Leafs',      'TOR', 'Toronto',       '{"primary":"#00205B","secondary":"#FFFFFF"}'),
  -- Metropolitan
  ('b0000000-0000-0000-0000-000000000005', 'Carolina Hurricanes',      'CAR', 'Raleigh',       '{"primary":"#CC0000","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Columbus Blue Jackets',    'CBJ', 'Columbus',      '{"primary":"#002654","secondary":"#CE1126"}'),
  ('b0000000-0000-0000-0000-000000000005', 'New Jersey Devils',        'NJD', 'Newark',        '{"primary":"#CE1126","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'New York Islanders',       'NYI', 'Elmont',        '{"primary":"#00539B","secondary":"#F47D30"}'),
  ('b0000000-0000-0000-0000-000000000005', 'New York Rangers',         'NYR', 'New York',      '{"primary":"#0038A8","secondary":"#CE1126"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Philadelphia Flyers',      'PHI', 'Philadelphia',  '{"primary":"#F74902","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Pittsburgh Penguins',      'PIT', 'Pittsburgh',    '{"primary":"#FCB514","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Washington Capitals',      'WSH', 'Washington',    '{"primary":"#C8102E","secondary":"#041E42"}'),
  -- Central
  ('b0000000-0000-0000-0000-000000000005', 'Arizona Coyotes',          'ARI', 'Salt Lake City','{"primary":"#8C2633","secondary":"#E2D6B5"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Chicago Blackhawks',       'CHI', 'Chicago',       '{"primary":"#CF0A2C","secondary":"#000000"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Colorado Avalanche',       'COL', 'Denver',        '{"primary":"#6F263D","secondary":"#236192"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Dallas Stars',             'DAL', 'Dallas',        '{"primary":"#006847","secondary":"#8F8F8C"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Minnesota Wild',           'MIN', 'Saint Paul',    '{"primary":"#154734","secondary":"#A6192E"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Nashville Predators',      'NSH', 'Nashville',     '{"primary":"#FFB81C","secondary":"#041E42"}'),
  ('b0000000-0000-0000-0000-000000000005', 'St. Louis Blues',          'STL', 'St. Louis',     '{"primary":"#002F87","secondary":"#FCB514"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Winnipeg Jets',            'WPG', 'Winnipeg',      '{"primary":"#041E42","secondary":"#004C97"}'),
  -- Pacific
  ('b0000000-0000-0000-0000-000000000005', 'Anaheim Ducks',            'ANA', 'Anaheim',       '{"primary":"#F47A38","secondary":"#B9975B"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Calgary Flames',           'CGY', 'Calgary',       '{"primary":"#D2001C","secondary":"#FAAF19"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Edmonton Oilers',          'EDM', 'Edmonton',      '{"primary":"#041E42","secondary":"#FF4C00"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Los Angeles Kings',        'LAK', 'Los Angeles',   '{"primary":"#111111","secondary":"#A2AAAD"}'),
  ('b0000000-0000-0000-0000-000000000005', 'San Jose Sharks',          'SJS', 'San Jose',      '{"primary":"#006D75","secondary":"#EA7200"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Seattle Kraken',           'SEA', 'Seattle',       '{"primary":"#001628","secondary":"#99D9D9"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Vancouver Canucks',        'VAN', 'Vancouver',     '{"primary":"#00205B","secondary":"#00843D"}'),
  ('b0000000-0000-0000-0000-000000000005', 'Vegas Golden Knights',     'VGK', 'Las Vegas',     '{"primary":"#B4975A","secondary":"#333F42"}');

-- =========================
--  Events — 2025-26 Seasons
-- =========================

INSERT INTO events (league_id, name, type, start_date, end_date, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'NFL 2025-26 Season',  'season', '2025-09-04', '2026-02-08', true),
  ('b0000000-0000-0000-0000-000000000002', 'NBA 2025-26 Season',  'season', '2025-10-21', '2026-06-18', true),
  ('b0000000-0000-0000-0000-000000000004', 'MLS 2026 Season',     'season', '2026-02-21', '2026-11-08', true),
  ('b0000000-0000-0000-0000-000000000005', 'NHL 2025-26 Season',  'season', '2025-10-07', '2026-06-15', true),
  ('b0000000-0000-0000-0000-000000000003', 'MLB 2026 Season',     'season', '2026-03-26', '2026-10-25', true);

-- =========================
--  Feature Flags
-- =========================

INSERT INTO feature_flags (key, enabled, start_date, end_date, config) VALUES
  ('world_cup_mode', true, '2026-06-11T00:00:00Z', '2026-07-19T23:59:59Z',
   '{"host_countries":["USA","Canada","Mexico"]}');
