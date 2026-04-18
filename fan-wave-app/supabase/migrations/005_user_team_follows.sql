-- ============================================================
-- Migration 005: User Team Follows with Per-Team Tiers
-- Replaces users.favorite_team_ids with a proper join table
-- ============================================================

-- 1. Create table
CREATE TABLE user_team_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'social' CHECK (tier IN ('lite', 'social', 'all_in')),
  followed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, team_id)
);

-- 2. Indexes
CREATE INDEX idx_user_team_follows_user ON user_team_follows(user_id);
CREATE INDEX idx_user_team_follows_team_tier ON user_team_follows(team_id, tier);

-- 3. RLS
ALTER TABLE user_team_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own follows"
  ON user_team_follows FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own follows"
  ON user_team_follows FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own follows"
  ON user_team_follows FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own follows"
  ON user_team_follows FOR DELETE
  USING (user_id = auth.uid());

-- 4. Migrate existing favorite_team_ids data
DO $$
DECLARE
  r RECORD;
  tid UUID;
BEGIN
  FOR r IN
    SELECT id, auth_id, favorite_team_ids
    FROM users
    WHERE favorite_team_ids IS NOT NULL
      AND array_length(favorite_team_ids, 1) > 0
  LOOP
    FOREACH tid IN ARRAY r.favorite_team_ids
    LOOP
      INSERT INTO user_team_follows (user_id, team_id, tier)
      VALUES (r.auth_id, tid, 'social')
      ON CONFLICT (user_id, team_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 5. RPC: Get user's followed teams with full details
CREATE OR REPLACE FUNCTION get_user_teams(p_user_id UUID)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  team_id UUID,
  tier TEXT,
  followed_at TIMESTAMPTZ,
  team_name TEXT,
  team_code TEXT,
  team_city TEXT,
  team_logo_url TEXT,
  team_colors JSONB,
  league_name TEXT,
  sport_name TEXT,
  sport_icon TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    utf.id,
    utf.user_id,
    utf.team_id,
    utf.tier,
    utf.followed_at,
    t.name AS team_name,
    t.code AS team_code,
    t.city AS team_city,
    t.logo_url AS team_logo_url,
    t.colors AS team_colors,
    l.name AS league_name,
    s.name AS sport_name,
    s.icon AS sport_icon
  FROM user_team_follows utf
  JOIN teams t ON t.id = utf.team_id
  JOIN leagues l ON l.id = t.league_id
  JOIN sports s ON s.id = l.sport_id
  WHERE utf.user_id = p_user_id
  ORDER BY utf.followed_at DESC;
$$;

-- 6. RPC: Follow a team (upsert with tier)
CREATE OR REPLACE FUNCTION follow_team(
  p_user_id UUID,
  p_team_id UUID,
  p_tier TEXT DEFAULT 'social'
)
RETURNS user_team_follows
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result user_team_follows;
BEGIN
  INSERT INTO user_team_follows (user_id, team_id, tier)
  VALUES (p_user_id, p_team_id, p_tier)
  ON CONFLICT (user_id, team_id)
  DO UPDATE SET tier = EXCLUDED.tier
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- 7. RPC: Unfollow a team
CREATE OR REPLACE FUNCTION unfollow_team(
  p_user_id UUID,
  p_team_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM user_team_follows
  WHERE user_id = p_user_id AND team_id = p_team_id;
END;
$$;
