-- 024: Fix geography RPCs (remove Unknown bucket) and seed test geo data

-- 1. Ensure city columns exist (023 added country/state but not city on some tables)
ALTER TABLE users        ADD COLUMN IF NOT EXISTS home_city    TEXT;
ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS venue_city  TEXT;
ALTER TABLE chat_rooms   ADD COLUMN IF NOT EXISTS city         TEXT;

-- 2. Re-create geography RPCs — filter out rows with no location data
CREATE OR REPLACE FUNCTION get_geo_countries()
RETURNS TABLE(country TEXT, user_count BIGINT, party_count BIGINT, group_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH uc AS (
    SELECT home_country AS c, COUNT(*) AS n
    FROM users WHERE home_country IS NOT NULL GROUP BY 1
  ),
  pc AS (
    SELECT venue_country AS c, COUNT(*) AS n
    FROM watch_parties WHERE venue_country IS NOT NULL GROUP BY 1
  ),
  gc AS (
    SELECT country AS c, COUNT(*) AS n
    FROM chat_rooms WHERE country IS NOT NULL GROUP BY 1
  ),
  all_c AS (
    SELECT c FROM uc UNION SELECT c FROM pc UNION SELECT c FROM gc
  )
  SELECT
    ac.c                  AS country,
    COALESCE(uc.n, 0)     AS user_count,
    COALESCE(pc.n, 0)     AS party_count,
    COALESCE(gc.n, 0)     AS group_count
  FROM all_c ac
  LEFT JOIN uc ON uc.c = ac.c
  LEFT JOIN pc ON pc.c = ac.c
  LEFT JOIN gc ON gc.c = ac.c
  WHERE is_admin()
  ORDER BY user_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_geo_states(p_country TEXT)
RETURNS TABLE(state TEXT, user_count BIGINT, party_count BIGINT, group_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH uc AS (
    SELECT home_state AS s, COUNT(*) AS n
    FROM users WHERE home_country = p_country AND home_state IS NOT NULL GROUP BY 1
  ),
  pc AS (
    SELECT venue_state AS s, COUNT(*) AS n
    FROM watch_parties WHERE venue_country = p_country AND venue_state IS NOT NULL GROUP BY 1
  ),
  gc AS (
    SELECT state AS s, COUNT(*) AS n
    FROM chat_rooms WHERE country = p_country AND state IS NOT NULL GROUP BY 1
  ),
  all_s AS (
    SELECT s FROM uc UNION SELECT s FROM pc UNION SELECT s FROM gc
  )
  SELECT
    ast.s                 AS state,
    COALESCE(uc.n, 0)     AS user_count,
    COALESCE(pc.n, 0)     AS party_count,
    COALESCE(gc.n, 0)     AS group_count
  FROM all_s ast
  LEFT JOIN uc ON uc.s = ast.s
  LEFT JOIN pc ON pc.s = ast.s
  LEFT JOIN gc ON gc.s = ast.s
  WHERE is_admin()
  ORDER BY user_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_geo_cities(p_country TEXT, p_state TEXT)
RETURNS TABLE(city TEXT, user_count BIGINT, party_count BIGINT, group_count BIGINT, clip_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH uc AS (
    SELECT home_city AS c, COUNT(*) AS n
    FROM users WHERE home_country = p_country AND home_state = p_state AND home_city IS NOT NULL GROUP BY 1
  ),
  pc AS (
    SELECT venue_city AS c, COUNT(*) AS n
    FROM watch_parties WHERE venue_country = p_country AND venue_state = p_state AND venue_city IS NOT NULL GROUP BY 1
  ),
  gc AS (
    SELECT city AS c, COUNT(*) AS n
    FROM chat_rooms WHERE country = p_country AND state = p_state AND city IS NOT NULL GROUP BY 1
  ),
  cc AS (
    SELECT u.home_city AS c, COUNT(mc.id) AS n
    FROM media_clips mc
    JOIN users u ON u.id = mc.user_id
    WHERE u.home_country = p_country AND u.home_state = p_state AND u.home_city IS NOT NULL
    GROUP BY 1
  ),
  all_c AS (
    SELECT c FROM uc UNION SELECT c FROM pc UNION SELECT c FROM gc UNION SELECT c FROM cc
  )
  SELECT
    ac.c                  AS city,
    COALESCE(uc.n, 0)     AS user_count,
    COALESCE(pc.n, 0)     AS party_count,
    COALESCE(gc.n, 0)     AS group_count,
    COALESCE(cc.n, 0)     AS clip_count
  FROM all_c ac
  LEFT JOIN uc ON uc.c = ac.c
  LEFT JOIN pc ON pc.c = ac.c
  LEFT JOIN gc ON gc.c = ac.c
  LEFT JOIN cc ON cc.c = ac.c
  WHERE is_admin()
  ORDER BY user_count DESC;
$$;

-- get_geo_city_detail: updated to use IS NOT NULL filters
CREATE OR REPLACE FUNCTION get_geo_city_detail(p_city TEXT, p_state TEXT, p_country TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'user_count',  (SELECT COUNT(*) FROM users WHERE home_city = p_city AND home_state = p_state AND home_country = p_country),
      'party_count', (SELECT COUNT(*) FROM watch_parties WHERE venue_city = p_city AND venue_state = p_state AND venue_country = p_country),
      'group_count', (SELECT COUNT(*) FROM chat_rooms WHERE city = p_city AND state = p_state AND country = p_country),
      'clip_count',  (SELECT COUNT(mc.id) FROM media_clips mc JOIN users u ON u.id = mc.user_id WHERE u.home_city = p_city AND u.home_state = p_state AND u.home_country = p_country)
    ),
    'recent_parties', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'venue_name', venue_name, 'rsvp_count', rsvp_count, 'starts_at', starts_at) ORDER BY created_at DESC), '[]')
      FROM watch_parties
      WHERE venue_city = p_city AND venue_state = p_state AND venue_country = p_country
        AND created_at >= NOW() - INTERVAL '30 days'
      LIMIT 5
    ),
    'active_groups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'member_count', member_count) ORDER BY member_count DESC), '[]')
      FROM chat_rooms WHERE city = p_city AND state = p_state AND country = p_country
      LIMIT 5
    ),
    'recent_signups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'created_at', created_at) ORDER BY created_at DESC), '[]')
      FROM users
      WHERE home_city = p_city AND home_state = p_state AND home_country = p_country
        AND created_at >= NOW() - INTERVAL '7 days'
      LIMIT 5
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 3. Seed geographic data for existing users (distribute across major fan markets)
WITH geo_map(rn_mod, c_country, c_state, c_city) AS (
  VALUES
    (0,  'United States', 'New York',           'New York City'),
    (1,  'United States', 'California',         'Los Angeles'),
    (2,  'United States', 'Texas',              'Houston'),
    (3,  'United States', 'Florida',            'Miami'),
    (4,  'United States', 'Illinois',           'Chicago'),
    (5,  'United Kingdom', 'England',           'London'),
    (6,  'United Kingdom', 'England',           'Manchester'),
    (7,  'Brazil',         'São Paulo',         'São Paulo'),
    (8,  'Brazil',         'Rio de Janeiro',    'Rio de Janeiro'),
    (9,  'Germany',        'Bavaria',           'Munich'),
    (10, 'Spain',          'Catalonia',         'Barcelona'),
    (11, 'France',         'Île-de-France',     'Paris')
),
numbered AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at) - 1) AS rn
  FROM users WHERE home_country IS NULL
)
UPDATE users
SET
  home_country = gm.c_country,
  home_state   = gm.c_state,
  home_city    = gm.c_city
FROM numbered n
JOIN geo_map gm ON gm.rn_mod = (n.rn % 12)
WHERE users.id = n.id;

-- 4. Seed geographic data for existing watch_parties
WITH geo_map(rn_mod, c_country, c_state, c_city) AS (
  VALUES
    (0,  'United States', 'New York',           'New York City'),
    (1,  'United States', 'California',         'Los Angeles'),
    (2,  'United States', 'Texas',              'Houston'),
    (3,  'United Kingdom', 'England',           'London'),
    (4,  'Brazil',         'São Paulo',         'São Paulo'),
    (5,  'Germany',        'Bavaria',           'Munich'),
    (6,  'United States', 'Florida',            'Miami'),
    (7,  'Spain',          'Catalonia',         'Barcelona')
),
numbered AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at) - 1) AS rn
  FROM watch_parties WHERE venue_country IS NULL
)
UPDATE watch_parties
SET
  venue_country = gm.c_country,
  venue_state   = gm.c_state,
  venue_city    = gm.c_city
FROM numbered n
JOIN geo_map gm ON gm.rn_mod = (n.rn % 8)
WHERE watch_parties.id = n.id;

-- 5. Seed geographic data for existing chat_rooms
WITH geo_map(rn_mod, c_country, c_state, c_city) AS (
  VALUES
    (0,  'United States', 'New York',           'New York City'),
    (1,  'United States', 'California',         'Los Angeles'),
    (2,  'United Kingdom', 'England',           'London'),
    (3,  'Brazil',         'São Paulo',         'São Paulo'),
    (4,  'United States', 'Texas',              'Houston'),
    (5,  'Germany',        'Bavaria',           'Munich'),
    (6,  'Spain',          'Catalonia',         'Barcelona'),
    (7,  'United States', 'Florida',            'Miami'),
    (8,  'France',         'Île-de-France',     'Paris'),
    (9,  'United Kingdom', 'England',           'Manchester'),
    (10, 'Brazil',         'Rio de Janeiro',    'Rio de Janeiro'),
    (11, 'United States', 'Illinois',           'Chicago')
),
numbered AS (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at) - 1) AS rn
  FROM chat_rooms WHERE country IS NULL
)
UPDATE chat_rooms
SET
  country = gm.c_country,
  state   = gm.c_state,
  city    = gm.c_city
FROM numbered n
JOIN geo_map gm ON gm.rn_mod = (n.rn % 12)
WHERE chat_rooms.id = n.id;
