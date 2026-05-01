-- ─── Admin Roles & Dashboard RPCs ─────────────────────────────────────────

-- 1. Admin roles table
CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_user_id ON admin_roles(user_id);

-- 2. Helper: checks if the current JWT belongs to an admin (bypasses RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles ar
    JOIN users u ON u.id = ar.user_id
    WHERE u.auth_id = auth.uid()
  );
$$;

-- Callable by frontend to check admin status without exposing the table
CREATE OR REPLACE FUNCTION check_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin();
$$;

-- 3. RLS on admin_roles
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_admin_roles" ON admin_roles
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "service_role_manage_admin_roles" ON admin_roles
  FOR ALL TO service_role USING (true);

-- 4. Geography columns on users, watch_parties, chat_rooms
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_state   TEXT;

ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS venue_country TEXT;
ALTER TABLE watch_parties ADD COLUMN IF NOT EXISTS venue_state   TEXT;

ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS state   TEXT;

CREATE INDEX IF NOT EXISTS idx_users_geo         ON users(home_country, home_state, home_city);
CREATE INDEX IF NOT EXISTS idx_parties_geo       ON watch_parties(venue_country, venue_state, venue_city);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_geo    ON chat_rooms(country, state, city);

-- 5. Admin read policies on existing tables
CREATE POLICY "admin_read_users" ON users
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admin_read_watch_parties" ON watch_parties
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admin_read_chat_rooms" ON chat_rooms
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admin_read_analytics_events" ON analytics_events
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admin_read_content_flags" ON content_flags
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY "admin_read_moderation_log" ON moderation_log
  FOR SELECT TO authenticated USING (is_admin());

-- 6. KPI aggregation RPC
-- p_days = 0 means all-time; any positive int is a rolling window
CREATE OR REPLACE FUNCTION get_admin_kpis(p_days INT DEFAULT 7)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := CASE
    WHEN p_days = 0 THEN '1970-01-01'::TIMESTAMPTZ
    ELSE NOW() - (p_days || ' days')::INTERVAL
  END;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN jsonb_build_object(
    'total_users',      (SELECT COUNT(*) FROM users),
    'new_users',        (SELECT COUNT(*) FROM users        WHERE created_at >= v_cutoff),
    'total_parties',    (SELECT COUNT(*) FROM watch_parties),
    'new_parties',      (SELECT COUNT(*) FROM watch_parties WHERE created_at >= v_cutoff),
    'total_groups',     (SELECT COUNT(*) FROM chat_rooms),
    'new_groups',       (SELECT COUNT(*) FROM chat_rooms    WHERE created_at >= v_cutoff),
    'total_clips',      (SELECT COUNT(*) FROM media_clips),
    'new_clips',        (SELECT COUNT(*) FROM media_clips   WHERE created_at >= v_cutoff),
    'total_rsvps',      (SELECT COUNT(*) FROM watch_party_rsvps),
    'new_rsvps',        (SELECT COUNT(*) FROM watch_party_rsvps WHERE created_at >= v_cutoff),
    'flagged_content',  (SELECT COUNT(*) FROM content_flags WHERE created_at >= v_cutoff)
  );
END;
$$;

-- 7. Signups by day
CREATE OR REPLACE FUNCTION get_signups_by_day(p_days INT DEFAULT 30)
RETURNS TABLE(signup_date DATE, signup_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    created_at::DATE AS signup_date,
    COUNT(*)         AS signup_count
  FROM users
  WHERE is_admin()
    AND created_at >= NOW() - (GREATEST(p_days, 1) || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 1 ASC;
$$;

-- 8. Parties by city
CREATE OR REPLACE FUNCTION get_parties_by_city(p_limit INT DEFAULT 10)
RETURNS TABLE(city TEXT, party_count BIGINT, rsvp_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(venue_city, 'Unknown') AS city,
    COUNT(*)                        AS party_count,
    COALESCE(SUM(rsvp_count), 0)   AS rsvp_count
  FROM watch_parties
  WHERE is_admin()
  GROUP BY 1
  ORDER BY party_count DESC
  LIMIT p_limit;
$$;

-- 9. Groups by sport
CREATE OR REPLACE FUNCTION get_groups_by_sport()
RETURNS TABLE(sport_name TEXT, group_count BIGINT, total_members BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(s.name, 'General') AS sport_name,
    COUNT(cr.id)                AS group_count,
    COALESCE(SUM(cr.member_count), 0) AS total_members
  FROM chat_rooms cr
  LEFT JOIN sports s ON s.id = cr.sport_id
  WHERE is_admin()
  GROUP BY 1
  ORDER BY group_count DESC;
$$;

-- 10. Activity feed (analytics_events joined with user display names)
CREATE OR REPLACE FUNCTION get_activity_feed(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_filter TEXT DEFAULT NULL
)
RETURNS TABLE(
  event_id        UUID,
  event_name      TEXT,
  user_display    TEXT,
  screen          TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ae.id            AS event_id,
    ae.event_name,
    COALESCE(u.display_name, 'Unknown') AS user_display,
    ae.screen,
    ae.metadata,
    ae.created_at
  FROM analytics_events ae
  LEFT JOIN users u ON u.id = ae.user_id
  WHERE is_admin()
    AND (p_filter IS NULL OR ae.event_name ILIKE '%' || p_filter || '%')
  ORDER BY ae.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- 11. Moderation queue
CREATE OR REPLACE FUNCTION get_moderation_queue(p_limit INT DEFAULT 50)
RETURNS TABLE(
  flag_id          UUID,
  content_type     TEXT,
  content_id       UUID,
  reason           TEXT,
  details          TEXT,
  flagger_display  TEXT,
  flag_count       BIGINT,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    cf.id                AS flag_id,
    cf.content_type,
    cf.content_id,
    cf.reason,
    cf.details,
    COALESCE(u.display_name, 'Unknown') AS flagger_display,
    COUNT(*) OVER (PARTITION BY cf.content_id) AS flag_count,
    cf.created_at
  FROM content_flags cf
  LEFT JOIN users u ON u.id = cf.flagger_id
  WHERE is_admin()
  ORDER BY cf.created_at DESC
  LIMIT p_limit;
$$;

-- 12. Geography RPCs
CREATE OR REPLACE FUNCTION get_geo_countries()
RETURNS TABLE(country TEXT, user_count BIGINT, party_count BIGINT, group_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH uc AS (
    SELECT COALESCE(home_country, 'Unknown') AS c, COUNT(*) AS n FROM users GROUP BY 1
  ),
  pc AS (
    SELECT COALESCE(venue_country, 'Unknown') AS c, COUNT(*) AS n FROM watch_parties GROUP BY 1
  ),
  gc AS (
    SELECT COALESCE(country, 'Unknown') AS c, COUNT(*) AS n FROM chat_rooms GROUP BY 1
  ),
  all_c AS (
    SELECT c FROM uc UNION SELECT c FROM pc UNION SELECT c FROM gc
  )
  SELECT
    ac.c                        AS country,
    COALESCE(uc.n, 0)           AS user_count,
    COALESCE(pc.n, 0)           AS party_count,
    COALESCE(gc.n, 0)           AS group_count
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
    SELECT COALESCE(home_state, 'Unknown') AS s, COUNT(*) AS n
    FROM users WHERE COALESCE(home_country, 'Unknown') = p_country GROUP BY 1
  ),
  pc AS (
    SELECT COALESCE(venue_state, 'Unknown') AS s, COUNT(*) AS n
    FROM watch_parties WHERE COALESCE(venue_country, 'Unknown') = p_country GROUP BY 1
  ),
  gc AS (
    SELECT COALESCE(state, 'Unknown') AS s, COUNT(*) AS n
    FROM chat_rooms WHERE COALESCE(country, 'Unknown') = p_country GROUP BY 1
  ),
  all_s AS (
    SELECT s FROM uc UNION SELECT s FROM pc UNION SELECT s FROM gc
  )
  SELECT
    ast.s                       AS state,
    COALESCE(uc.n, 0)           AS user_count,
    COALESCE(pc.n, 0)           AS party_count,
    COALESCE(gc.n, 0)           AS group_count
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
    SELECT COALESCE(home_city, 'Unknown') AS c, COUNT(*) AS n
    FROM users
    WHERE COALESCE(home_country, 'Unknown') = p_country
      AND COALESCE(home_state, 'Unknown')   = p_state
    GROUP BY 1
  ),
  pc AS (
    SELECT COALESCE(venue_city, 'Unknown') AS c, COUNT(*) AS n
    FROM watch_parties
    WHERE COALESCE(venue_country, 'Unknown') = p_country
      AND COALESCE(venue_state, 'Unknown')   = p_state
    GROUP BY 1
  ),
  gc AS (
    SELECT COALESCE(city, 'Unknown') AS c, COUNT(*) AS n
    FROM chat_rooms
    WHERE COALESCE(country, 'Unknown') = p_country
      AND COALESCE(state, 'Unknown')   = p_state
    GROUP BY 1
  ),
  cc AS (
    SELECT COALESCE(u.home_city, 'Unknown') AS c, COUNT(mc.id) AS n
    FROM media_clips mc
    JOIN users u ON u.id = mc.user_id
    WHERE COALESCE(u.home_country, 'Unknown') = p_country
      AND COALESCE(u.home_state, 'Unknown')   = p_state
    GROUP BY 1
  ),
  all_c AS (
    SELECT c FROM uc UNION SELECT c FROM pc UNION SELECT c FROM gc UNION SELECT c FROM cc
  )
  SELECT
    ac.c                        AS city,
    COALESCE(uc.n, 0)           AS user_count,
    COALESCE(pc.n, 0)           AS party_count,
    COALESCE(gc.n, 0)           AS group_count,
    COALESCE(cc.n, 0)           AS clip_count
  FROM all_c ac
  LEFT JOIN uc ON uc.c = ac.c
  LEFT JOIN pc ON pc.c = ac.c
  LEFT JOIN gc ON gc.c = ac.c
  LEFT JOIN cc ON cc.c = ac.c
  WHERE is_admin()
  ORDER BY user_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_geo_city_detail(p_city TEXT, p_state TEXT, p_country TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'user_count',  (SELECT COUNT(*) FROM users         WHERE COALESCE(home_city, 'Unknown') = p_city AND COALESCE(home_state, 'Unknown') = p_state AND COALESCE(home_country, 'Unknown') = p_country),
      'party_count', (SELECT COUNT(*) FROM watch_parties WHERE COALESCE(venue_city, 'Unknown') = p_city AND COALESCE(venue_state, 'Unknown') = p_state AND COALESCE(venue_country, 'Unknown') = p_country),
      'group_count', (SELECT COUNT(*) FROM chat_rooms    WHERE COALESCE(city, 'Unknown') = p_city AND COALESCE(state, 'Unknown') = p_state AND COALESCE(country, 'Unknown') = p_country),
      'clip_count',  (SELECT COUNT(mc.id) FROM media_clips mc JOIN users u ON u.id = mc.user_id WHERE COALESCE(u.home_city, 'Unknown') = p_city AND COALESCE(u.home_state, 'Unknown') = p_state AND COALESCE(u.home_country, 'Unknown') = p_country)
    ),
    'recent_parties', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'venue_name', venue_name, 'rsvp_count', rsvp_count, 'starts_at', starts_at) ORDER BY created_at DESC), '[]')
      FROM watch_parties
      WHERE COALESCE(venue_city, 'Unknown') = p_city AND COALESCE(venue_state, 'Unknown') = p_state AND COALESCE(venue_country, 'Unknown') = p_country
        AND created_at >= NOW() - INTERVAL '30 days'
      LIMIT 5
    ),
    'active_groups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'member_count', member_count) ORDER BY member_count DESC), '[]')
      FROM chat_rooms
      WHERE COALESCE(city, 'Unknown') = p_city AND COALESCE(state, 'Unknown') = p_state AND COALESCE(country, 'Unknown') = p_country
      LIMIT 5
    ),
    'recent_signups', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'created_at', created_at) ORDER BY created_at DESC), '[]')
      FROM users
      WHERE COALESCE(home_city, 'Unknown') = p_city AND COALESCE(home_state, 'Unknown') = p_state AND COALESCE(home_country, 'Unknown') = p_country
        AND created_at >= NOW() - INTERVAL '7 days'
      LIMIT 5
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 13. Admin moderation action: dismiss or remove flagged content
CREATE OR REPLACE FUNCTION admin_moderate_content(
  p_flag_id    UUID,
  p_action     TEXT,  -- 'dismiss' | 'remove'
  p_content_type TEXT,
  p_content_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_user_id UUID;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;

  SELECT id INTO v_admin_user_id FROM users WHERE auth_id = auth.uid();

  -- Log the moderation action
  INSERT INTO moderation_log(action, content_type, content_id, performed_by, details)
  VALUES (p_action, p_content_type, p_content_id, v_admin_user_id,
          jsonb_build_object('flag_id', p_flag_id));

  -- If removing a watch party, update its status
  IF p_action = 'remove' AND p_content_type = 'watch_party' THEN
    UPDATE watch_parties SET moderation_status = 'removed' WHERE id = p_content_id;
  END IF;

  -- Delete the flag
  DELETE FROM content_flags WHERE id = p_flag_id;
END;
$$;
