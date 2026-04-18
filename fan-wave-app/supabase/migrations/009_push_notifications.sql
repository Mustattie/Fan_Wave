-- ============================================================
-- Migration 009: Push Notification Infrastructure
--
-- 1. Add push_token and notification_preferences to users
-- 2. RPC to register/clear push tokens
-- ============================================================

-- =========================
-- 1. ADD COLUMNS
-- =========================

ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{
  "score_updates": true,
  "game_reminders": true,
  "watch_party_reminders": true,
  "group_activity": true,
  "moment_alerts": false,
  "clip_posted": false
}'::jsonb;

-- Index for finding users with push tokens by team follow
CREATE INDEX IF NOT EXISTS idx_users_push_token ON users(auth_id) WHERE push_token IS NOT NULL;

-- =========================
-- 2. RPC: Register push token
-- =========================

CREATE OR REPLACE FUNCTION register_push_token(p_token TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE users
       SET push_token = p_token
     WHERE auth_id = auth.uid();
END;
$$;

-- =========================
-- 3. RPC: Clear push token (on sign out)
-- =========================

CREATE OR REPLACE FUNCTION clear_push_token()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE users
       SET push_token = NULL
     WHERE auth_id = auth.uid();
END;
$$;

-- =========================
-- 4. RPC: Update notification preferences
-- =========================

CREATE OR REPLACE FUNCTION update_notification_preferences(p_preferences JSONB)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE users
       SET notification_preferences = p_preferences
     WHERE auth_id = auth.uid();
END;
$$;
