-- ============================================================
-- Migration 011: Creator Follow System
--
-- 1. user_follows table
-- 2. follower/following counts on users
-- 3. Triggers for count maintenance
-- 4. RPCs for follow/unfollow/check
-- 5. Bio column on users
-- ============================================================

-- =========================
-- 1. USER FOLLOWS TABLE
-- =========================

CREATE TABLE IF NOT EXISTS user_follows (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id  UUID NOT NULL,
    following_id UUID NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(follower_id, following_id),
    CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);

-- RLS
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_follows_select ON user_follows
    FOR SELECT TO authenticated USING (true);

CREATE POLICY user_follows_insert ON user_follows
    FOR INSERT TO authenticated
    WITH CHECK (follower_id = auth.uid());

CREATE POLICY user_follows_delete ON user_follows
    FOR DELETE TO authenticated
    USING (follower_id = auth.uid());

-- =========================
-- 2. ADD COLUMNS TO USERS
-- =========================

ALTER TABLE users ADD COLUMN IF NOT EXISTS follower_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';

-- =========================
-- 3. TRIGGERS FOR COUNT MAINTENANCE
-- =========================

CREATE OR REPLACE FUNCTION update_follow_counts_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET following_count = (
        SELECT COUNT(*) FROM user_follows WHERE follower_id = NEW.follower_id
    ) WHERE auth_id = NEW.follower_id;

    UPDATE users SET follower_count = (
        SELECT COUNT(*) FROM user_follows WHERE following_id = NEW.following_id
    ) WHERE auth_id = NEW.following_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION update_follow_counts_on_delete()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users SET following_count = (
        SELECT COUNT(*) FROM user_follows WHERE follower_id = OLD.follower_id
    ) WHERE auth_id = OLD.follower_id;

    UPDATE users SET follower_count = (
        SELECT COUNT(*) FROM user_follows WHERE following_id = OLD.following_id
    ) WHERE auth_id = OLD.following_id;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_user_follow_insert ON user_follows;
CREATE TRIGGER trg_user_follow_insert
    AFTER INSERT ON user_follows
    FOR EACH ROW EXECUTE FUNCTION update_follow_counts_on_insert();

DROP TRIGGER IF EXISTS trg_user_follow_delete ON user_follows;
CREATE TRIGGER trg_user_follow_delete
    AFTER DELETE ON user_follows
    FOR EACH ROW EXECUTE FUNCTION update_follow_counts_on_delete();

-- =========================
-- 4. RPCs
-- =========================

-- Follow a user
CREATE OR REPLACE FUNCTION follow_user(p_following_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    IF p_following_id = auth.uid() THEN
        RAISE EXCEPTION 'cannot follow yourself';
    END IF;

    INSERT INTO user_follows (follower_id, following_id)
    VALUES (auth.uid(), p_following_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;
END;
$$;

-- Unfollow a user
CREATE OR REPLACE FUNCTION unfollow_user(p_following_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM user_follows
    WHERE follower_id = auth.uid() AND following_id = p_following_id;
END;
$$;

-- Check if current user follows a specific user
CREATE OR REPLACE FUNCTION is_following(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_follows
        WHERE follower_id = auth.uid() AND following_id = p_user_id
    );
$$;

-- Get followers of a user
CREATE OR REPLACE FUNCTION get_followers(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, follower_count INT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT u.auth_id, u.display_name, u.avatar_url, u.follower_count
    FROM user_follows uf
    JOIN users u ON u.auth_id = uf.follower_id
    WHERE uf.following_id = p_user_id
    ORDER BY uf.created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$;

-- Get users that a user follows
CREATE OR REPLACE FUNCTION get_following(p_user_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS TABLE(user_id UUID, display_name TEXT, avatar_url TEXT, follower_count INT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT u.auth_id, u.display_name, u.avatar_url, u.follower_count
    FROM user_follows uf
    JOIN users u ON u.auth_id = uf.following_id
    WHERE uf.follower_id = p_user_id
    ORDER BY uf.created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$;
