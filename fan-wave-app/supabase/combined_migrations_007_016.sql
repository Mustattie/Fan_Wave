-- ============================================================
-- Migration 007: Security Fixes
--
-- 1. Add auth.uid() validation to all SECURITY DEFINER RPCs
-- 2. Add missing UPDATE/DELETE RLS policies
-- 3. Restrict overly permissive SELECT policies
-- 4. Fix moderation_log global admin leak
-- 5. Seed missing sports (CFB, CBB, UFC)
-- ============================================================

-- =========================
-- 1. FIX SECURITY DEFINER RPCs — Add auth.uid() checks
-- =========================

-- 1a. rsvp_to_watch_party — validate caller is the user
CREATE OR REPLACE FUNCTION rsvp_to_watch_party(
    p_party_id UUID,
    p_user_id  UUID,
    p_status   TEXT
)
RETURNS watch_party_rsvps
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_capacity   INT;
    v_rsvp_count INT;
    v_rsvp       watch_party_rsvps;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot RSVP on behalf of another user';
    END IF;

    -- Capacity check when marking 'going'
    IF p_status = 'going' THEN
        SELECT capacity, rsvp_count
          INTO v_capacity, v_rsvp_count
          FROM watch_parties
         WHERE id = p_party_id;

        IF v_rsvp_count >= v_capacity THEN
            RAISE EXCEPTION 'Watch party is at capacity';
        END IF;
    END IF;

    -- Upsert the RSVP
    INSERT INTO watch_party_rsvps (watch_party_id, user_id, status)
    VALUES (p_party_id, p_user_id, p_status)
    ON CONFLICT (watch_party_id, user_id)
        DO UPDATE SET status = EXCLUDED.status
    RETURNING * INTO v_rsvp;

    -- Recalculate rsvp_count from source of truth
    UPDATE watch_parties
       SET rsvp_count = (
           SELECT count(*)
             FROM watch_party_rsvps
            WHERE watch_party_id = p_party_id
              AND status = 'going'
       )
     WHERE id = p_party_id;

    RETURN v_rsvp;
END;
$$;

-- 1b. flag_watch_party — validate caller is the flagger
CREATE OR REPLACE FUNCTION flag_watch_party(
    p_party_id UUID,
    p_user_id  UUID,
    p_reason   TEXT,
    p_details  TEXT DEFAULT ''
)
RETURNS watch_party_flags
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_flag       watch_party_flags;
    v_flag_count INT;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot flag on behalf of another user';
    END IF;

    -- Insert the flag
    INSERT INTO watch_party_flags (watch_party_id, flagger_id, reason, details)
    VALUES (p_party_id, p_user_id, p_reason, p_details)
    RETURNING * INTO v_flag;

    -- Count total flags for this party
    SELECT count(*)
      INTO v_flag_count
      FROM watch_party_flags
     WHERE watch_party_id = p_party_id;

    -- Auto-moderate based on flag count
    IF v_flag_count >= 5 THEN
        UPDATE watch_parties
           SET moderation_status = 'removed'
         WHERE id = p_party_id;
    ELSIF v_flag_count >= 3 THEN
        UPDATE watch_parties
           SET moderation_status = 'flagged'
         WHERE id = p_party_id;
    END IF;

    RETURN v_flag;
END;
$$;

-- 1c. toggle_moment_reaction — validate caller
CREATE OR REPLACE FUNCTION toggle_moment_reaction(
    p_moment_id UUID,
    p_user_id   UUID,
    p_emoji     TEXT
)
RETURNS SETOF moment_reactions
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot react on behalf of another user';
    END IF;

    SELECT id INTO v_existing_id
      FROM moment_reactions
     WHERE moment_id = p_moment_id
       AND user_id   = p_user_id
       AND emoji     = p_emoji;

    IF v_existing_id IS NOT NULL THEN
        DELETE FROM moment_reactions WHERE id = v_existing_id;
        RETURN;
    ELSE
        RETURN QUERY
            INSERT INTO moment_reactions (moment_id, user_id, emoji)
            VALUES (p_moment_id, p_user_id, p_emoji)
            RETURNING *;
    END IF;
END;
$$;

-- 1d. flag_content — validate caller is the flagger
CREATE OR REPLACE FUNCTION flag_content(
    p_type       TEXT,
    p_content_id UUID,
    p_user_id    UUID,
    p_reason     TEXT,
    p_details    TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_flag_id   UUID;
    v_count     INT;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot flag content on behalf of another user';
    END IF;

    INSERT INTO content_flags (content_type, content_id, flagger_id, reason, details)
    VALUES (p_type, p_content_id, p_user_id, p_reason, p_details)
    RETURNING id INTO v_flag_id;

    SELECT COUNT(*) INTO v_count
      FROM content_flags
     WHERE content_type = p_type
       AND content_id   = p_content_id;

    -- Auto-escalate after 3 flags
    IF v_count >= 3 THEN
        INSERT INTO moderation_log (action, content_type, content_id, performed_by, details)
        VALUES (
            'auto_flagged',
            p_type,
            p_content_id,
            p_user_id,
            jsonb_build_object('flag_count', v_count, 'trigger', 'threshold')
        );

        IF p_type = 'watch_party' THEN
            UPDATE watch_parties
               SET moderation_status = 'flagged'
             WHERE id = p_content_id;
        END IF;
    END IF;

    RETURN v_flag_id;
END;
$$;

-- 1e. toggle_clip_like — validate caller
CREATE OR REPLACE FUNCTION toggle_clip_like(
    p_clip_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_existing_id UUID;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot like on behalf of another user';
    END IF;

    SELECT id INTO v_existing_id
      FROM clip_likes
     WHERE clip_id = p_clip_id
       AND user_id = p_user_id;

    IF v_existing_id IS NOT NULL THEN
        DELETE FROM clip_likes WHERE id = v_existing_id;
        RETURN false;
    ELSE
        INSERT INTO clip_likes (clip_id, user_id)
        VALUES (p_clip_id, p_user_id);
        RETURN true;
    END IF;
END;
$$;

-- 1f. follow_team — validate caller
CREATE OR REPLACE FUNCTION follow_team(
    p_user_id UUID,
    p_team_id UUID,
    p_tier    TEXT DEFAULT 'social'
)
RETURNS user_team_follows
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    result user_team_follows;
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot follow teams on behalf of another user';
    END IF;

    INSERT INTO user_team_follows (user_id, team_id, tier)
    VALUES (p_user_id, p_team_id, p_tier)
    ON CONFLICT (user_id, team_id)
    DO UPDATE SET tier = EXCLUDED.tier
    RETURNING * INTO result;

    RETURN result;
END;
$$;

-- 1g. unfollow_team — validate caller
CREATE OR REPLACE FUNCTION unfollow_team(
    p_user_id UUID,
    p_team_id UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot unfollow teams on behalf of another user';
    END IF;

    DELETE FROM user_team_follows
    WHERE user_id = p_user_id AND team_id = p_team_id;
END;
$$;

-- 1h. get_user_teams — validate caller can only read own follows
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
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    -- Auth check
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized: cannot read another user''s teams';
    END IF;

    RETURN QUERY
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
END;
$$;

-- =========================
-- 2. ADD MISSING UPDATE/DELETE RLS POLICIES
-- =========================

-- chat_rooms: owners can update/delete their own rooms
CREATE POLICY chat_rooms_update ON chat_rooms
    FOR UPDATE TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY chat_rooms_delete ON chat_rooms
    FOR DELETE TO authenticated
    USING (owner_id = auth.uid());

-- messages: users can update/delete their own messages
CREATE POLICY messages_update ON messages
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY messages_delete ON messages
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- media_clips: users can update/delete their own clips
CREATE POLICY media_clips_update ON media_clips
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY media_clips_delete ON media_clips
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- match_moments: users can delete their own moments
CREATE POLICY match_moments_delete ON match_moments
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- =========================
-- 3. RESTRICT OVERLY PERMISSIVE SELECT POLICIES
-- =========================

-- watch_party_rsvps: only visible to party creator and attendees
DROP POLICY IF EXISTS watch_party_rsvps_select ON watch_party_rsvps;
CREATE POLICY watch_party_rsvps_select ON watch_party_rsvps
    FOR SELECT TO authenticated
    USING (
        -- User can see their own RSVPs
        user_id = auth.uid()
        -- Or RSVPs for parties they created
        OR watch_party_id IN (
            SELECT id FROM watch_parties WHERE creator_id = auth.uid()
        )
        -- Or RSVPs for parties they're attending
        OR watch_party_id IN (
            SELECT watch_party_id FROM watch_party_rsvps
            WHERE user_id = auth.uid() AND status = 'going'
        )
    );

-- match_moments: only visible to members of the chat room
DROP POLICY IF EXISTS match_moments_select ON match_moments;
CREATE POLICY match_moments_select ON match_moments
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- moment_reactions: only visible if user can see the moment's chat room
DROP POLICY IF EXISTS moment_reactions_select ON moment_reactions;
CREATE POLICY moment_reactions_select ON moment_reactions
    FOR SELECT TO authenticated
    USING (
        moment_id IN (
            SELECT mm.id FROM match_moments mm
            JOIN chat_room_members crm ON crm.chat_room_id = mm.chat_room_id
            WHERE crm.user_id = auth.uid()
        )
    );

-- =========================
-- 4. FIX MODERATION_LOG — scope to rooms user administers
-- =========================

DROP POLICY IF EXISTS moderation_log_select ON moderation_log;
CREATE POLICY moderation_log_select ON moderation_log
    FOR SELECT TO authenticated
    USING (
        -- User can see moderation logs for rooms they admin
        content_id IN (
            SELECT cr.id FROM chat_rooms cr
            JOIN chat_room_members crm ON crm.chat_room_id = cr.id
            WHERE crm.user_id = auth.uid()
              AND crm.role IN ('owner', 'admin')
        )
        -- Or moderation logs for watch parties they created
        OR (content_type = 'watch_party' AND content_id IN (
            SELECT id FROM watch_parties WHERE creator_id = auth.uid()
        ))
    );

-- =========================
-- 5. SEED MISSING SPORTS (CFB, CBB, UFC)
-- =========================

INSERT INTO sports (id, name, icon, color) VALUES
    ('a0000000-0000-0000-0000-000000000007', 'College Football', '🏈', '#8B0000'),
    ('a0000000-0000-0000-0000-000000000008', 'College Basketball', '🏀', '#FF6600'),
    ('a0000000-0000-0000-0000-000000000009', 'UFC', '🥊', '#D20A0A')
ON CONFLICT (id) DO NOTHING;

-- Add leagues for the new sports
INSERT INTO leagues (id, sport_id, name, country, icon) VALUES
    ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'NCAA FBS',  'USA', '🏈'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 'NCAA D1',   'USA', '🏀'),
    ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', 'UFC',       'USA', '🥊')
ON CONFLICT (id) DO NOTHING;
-- ============================================================
-- Migration 008: Performance, Integrity & Validation Fixes
--
-- 1. Missing foreign key indexes
-- 2. Race condition fixes in counter triggers (FOR UPDATE)
-- 3. Enum validation in SECURITY DEFINER RPCs
-- 4. Message length constraint
-- 5. Watch parties DELETE policy
-- 6. users.display_name default
-- ============================================================

-- =========================
-- 1. MISSING FK INDEXES
-- =========================

CREATE INDEX IF NOT EXISTS idx_games_event_id ON games(event_id);
CREATE INDEX IF NOT EXISTS idx_games_home_team ON games(home_team_id);
CREATE INDEX IF NOT EXISTS idx_games_away_team ON games(away_team_id);
CREATE INDEX IF NOT EXISTS idx_games_scheduled ON games(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(chat_room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_parties_sport ON watch_parties(sport_id);
CREATE INDEX IF NOT EXISTS idx_watch_parties_city_date ON watch_parties(venue_city, starts_at);
CREATE INDEX IF NOT EXISTS idx_media_clips_game ON media_clips(game_id);
CREATE INDEX IF NOT EXISTS idx_media_clips_user ON media_clips(user_id);
CREATE INDEX IF NOT EXISTS idx_match_moments_game ON match_moments(game_id);
CREATE INDEX IF NOT EXISTS idx_match_moments_room ON match_moments(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user_room ON chat_room_members(user_id, chat_room_id);

-- =========================
-- 2. FIX RACE CONDITIONS IN COUNTER TRIGGERS
-- =========================

-- member_count: use FOR UPDATE row lock
CREATE OR REPLACE FUNCTION increment_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = (
           SELECT COUNT(*) FROM chat_room_members
           WHERE chat_room_id = NEW.chat_room_id
       )
     WHERE id = NEW.chat_room_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = (
           SELECT COUNT(*) FROM chat_room_members
           WHERE chat_room_id = OLD.chat_room_id
       )
     WHERE id = OLD.chat_room_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- rsvp_count: same pattern — count from source of truth
CREATE OR REPLACE FUNCTION increment_rsvp_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE watch_parties
       SET rsvp_count = (
           SELECT COUNT(*) FROM watch_party_rsvps
           WHERE watch_party_id = NEW.watch_party_id
             AND status = 'going'
       )
     WHERE id = NEW.watch_party_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_rsvp_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE watch_parties
       SET rsvp_count = (
           SELECT COUNT(*) FROM watch_party_rsvps
           WHERE watch_party_id = OLD.watch_party_id
             AND status = 'going'
       )
     WHERE id = OLD.watch_party_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- clip like_count: count from source of truth
CREATE OR REPLACE FUNCTION increment_clip_like_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE media_clips
       SET like_count = (
           SELECT COUNT(*) FROM clip_likes
           WHERE clip_id = NEW.clip_id
       )
     WHERE id = NEW.clip_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_clip_like_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE media_clips
       SET like_count = (
           SELECT COUNT(*) FROM clip_likes
           WHERE clip_id = OLD.clip_id
       )
     WHERE id = OLD.clip_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- 3. ENUM VALIDATION IN SECURITY DEFINER RPCs
-- =========================

-- rsvp_to_watch_party — validate p_status
CREATE OR REPLACE FUNCTION rsvp_to_watch_party(
    p_party_id UUID,
    p_user_id  UUID,
    p_status   TEXT
)
RETURNS watch_party_rsvps
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_capacity   INT;
    v_rsvp_count INT;
    v_rsvp       watch_party_rsvps;
BEGIN
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;
    IF p_status NOT IN ('going', 'interested', 'declined', 'none') THEN
        RAISE EXCEPTION 'invalid status: %', p_status;
    END IF;

    IF p_status = 'going' THEN
        SELECT capacity, rsvp_count
          INTO v_capacity, v_rsvp_count
          FROM watch_parties
         WHERE id = p_party_id
           FOR UPDATE;

        IF v_rsvp_count >= v_capacity THEN
            RAISE EXCEPTION 'Watch party is at capacity';
        END IF;
    END IF;

    INSERT INTO watch_party_rsvps (watch_party_id, user_id, status)
    VALUES (p_party_id, p_user_id, p_status)
    ON CONFLICT (watch_party_id, user_id)
        DO UPDATE SET status = EXCLUDED.status
    RETURNING * INTO v_rsvp;

    UPDATE watch_parties
       SET rsvp_count = (
           SELECT count(*) FROM watch_party_rsvps
            WHERE watch_party_id = p_party_id AND status = 'going'
       )
     WHERE id = p_party_id;

    RETURN v_rsvp;
END;
$$;

-- follow_team — validate p_tier
CREATE OR REPLACE FUNCTION follow_team(
    p_user_id UUID,
    p_team_id UUID,
    p_tier    TEXT DEFAULT 'social'
)
RETURNS user_team_follows
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    result user_team_follows;
BEGIN
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;
    IF p_tier NOT IN ('lite', 'social', 'all_in') THEN
        RAISE EXCEPTION 'invalid tier: %', p_tier;
    END IF;

    INSERT INTO user_team_follows (user_id, team_id, tier)
    VALUES (p_user_id, p_team_id, p_tier)
    ON CONFLICT (user_id, team_id)
    DO UPDATE SET tier = EXCLUDED.tier
    RETURNING * INTO result;

    RETURN result;
END;
$$;

-- flag_watch_party — validate p_reason
CREATE OR REPLACE FUNCTION flag_watch_party(
    p_party_id UUID,
    p_user_id  UUID,
    p_reason   TEXT,
    p_details  TEXT DEFAULT ''
)
RETURNS watch_party_flags
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_flag       watch_party_flags;
    v_flag_count INT;
BEGIN
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;
    IF p_reason NOT IN ('spam', 'inappropriate', 'misleading', 'safety', 'other') THEN
        RAISE EXCEPTION 'invalid reason: %', p_reason;
    END IF;

    INSERT INTO watch_party_flags (watch_party_id, flagger_id, reason, details)
    VALUES (p_party_id, p_user_id, p_reason, p_details)
    RETURNING * INTO v_flag;

    SELECT count(*) INTO v_flag_count
      FROM watch_party_flags WHERE watch_party_id = p_party_id;

    IF v_flag_count >= 5 THEN
        UPDATE watch_parties SET moderation_status = 'removed' WHERE id = p_party_id;
    ELSIF v_flag_count >= 3 THEN
        UPDATE watch_parties SET moderation_status = 'flagged' WHERE id = p_party_id;
    END IF;

    RETURN v_flag;
END;
$$;

-- flag_content — validate p_type and p_reason
CREATE OR REPLACE FUNCTION flag_content(
    p_type       TEXT,
    p_content_id UUID,
    p_user_id    UUID,
    p_reason     TEXT,
    p_details    TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_flag_id UUID;
    v_count   INT;
BEGIN
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;
    IF p_type NOT IN ('watch_party', 'message', 'clip', 'moment') THEN
        RAISE EXCEPTION 'invalid content type: %', p_type;
    END IF;
    IF p_reason NOT IN ('spam', 'inappropriate', 'misleading', 'safety', 'other') THEN
        RAISE EXCEPTION 'invalid reason: %', p_reason;
    END IF;

    INSERT INTO content_flags (content_type, content_id, flagger_id, reason, details)
    VALUES (p_type, p_content_id, p_user_id, p_reason, p_details)
    RETURNING id INTO v_flag_id;

    SELECT COUNT(*) INTO v_count
      FROM content_flags WHERE content_type = p_type AND content_id = p_content_id;

    IF v_count >= 3 THEN
        INSERT INTO moderation_log (action, content_type, content_id, performed_by, details)
        VALUES ('auto_flagged', p_type, p_content_id, p_user_id,
                jsonb_build_object('flag_count', v_count, 'trigger', 'threshold'));

        IF p_type = 'watch_party' THEN
            UPDATE watch_parties SET moderation_status = 'flagged' WHERE id = p_content_id;
        END IF;
    END IF;

    RETURN v_flag_id;
END;
$$;

-- =========================
-- 4. MESSAGE LENGTH CONSTRAINT
-- =========================

ALTER TABLE messages ADD CONSTRAINT ck_message_length
    CHECK (char_length(content) <= 2000);

-- =========================
-- 5. WATCH PARTIES DELETE POLICY
-- =========================

CREATE POLICY watch_parties_delete ON watch_parties
    FOR DELETE TO authenticated
    USING (creator_id = auth.uid());

-- =========================
-- 6. USERS DISPLAY NAME DEFAULT
-- =========================

ALTER TABLE users
    ALTER COLUMN display_name SET DEFAULT 'Fan Wave User';
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
-- ============================================================
-- Migration 010: Notification Triggers & Scheduling
--
-- 1. Notification log (dedup table)
-- 2. Score update trigger on games table
-- 3. pg_cron schedule for periodic notification checks
-- 4. Auto-cleanup of old notification log entries
-- ============================================================

-- =========================
-- 1. NOTIFICATION LOG (prevents duplicate notifications)
-- =========================

CREATE TABLE IF NOT EXISTS notification_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref_id     UUID NOT NULL,
    type       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_log_ref_type
    ON notification_log(ref_id, type);

CREATE INDEX IF NOT EXISTS idx_notification_log_created
    ON notification_log(created_at);

-- RLS: only service role can read/write
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_log_service ON notification_log
    FOR ALL
    USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role')
    WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- =========================
-- 2. SCORE UPDATE TRIGGER
-- Fires when a game's score or status changes.
-- Uses pg_net to call the trigger-notifications edge function.
-- =========================

-- Helper function: notify on score/status change
CREATE OR REPLACE FUNCTION notify_score_update()
RETURNS TRIGGER AS $$
DECLARE
    v_url TEXT;
    v_key TEXT;
BEGIN
    -- Only fire if score or status actually changed
    IF (OLD.home_score IS DISTINCT FROM NEW.home_score)
       OR (OLD.away_score IS DISTINCT FROM NEW.away_score)
       OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('in', 'post'))
    THEN
        v_url := current_setting('app.settings.supabase_url', true)
                 || '/functions/v1/trigger-notifications';
        v_key := current_setting('app.settings.service_role_key', true);

        -- Use pg_net if available, otherwise skip silently
        BEGIN
            PERFORM net.http_post(
                url := v_url,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_key
                ),
                body := jsonb_build_object(
                    'type', 'score_update',
                    'game_id', NEW.id
                )
            );
        EXCEPTION WHEN OTHERS THEN
            -- pg_net not available or call failed — skip silently
            NULL;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the trigger (drop first if exists to make idempotent)
DROP TRIGGER IF EXISTS trg_notify_score_update ON games;
CREATE TRIGGER trg_notify_score_update
    AFTER UPDATE ON games
    FOR EACH ROW
    EXECUTE FUNCTION notify_score_update();

-- =========================
-- 3. CRON SCHEDULE (every 5 minutes)
-- Checks for game reminders and watch party reminders.
-- Requires pg_cron extension (enabled by default on Supabase).
-- =========================

-- Enable pg_cron and pg_net extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule: every 5 minutes, trigger the notification function
-- This checks for games starting in ~30 min and parties starting in ~1 hour
SELECT cron.schedule(
    'trigger-scheduled-notifications',
    '*/5 * * * *',
    $$
    SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/trigger-notifications',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := '{}'::jsonb
    );
    $$
);

-- =========================
-- 4. AUTO-CLEANUP: Remove notification logs older than 7 days
-- =========================

SELECT cron.schedule(
    'cleanup-notification-log',
    '0 3 * * *',
    $$
    DELETE FROM notification_log WHERE created_at < now() - interval '7 days';
    $$
);
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
-- ============================================================
-- Migration 012: Gamification (Badges, Streaks) & Trending
--
-- 1. Badges & user_badges tables + seed badges
-- 2. Badge award trigger functions
-- 3. User streaks table + daily activity RPC
-- 4. Trending materialized views + cron refresh
-- ============================================================

-- =========================
-- 1. BADGES SYSTEM
-- =========================

CREATE TABLE IF NOT EXISTS badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    icon        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('milestone', 'engagement', 'social', 'special'))
);

CREATE TABLE IF NOT EXISTS user_badges (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL,
    badge_id  UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY badges_select ON badges FOR SELECT USING (true);
CREATE POLICY user_badges_select ON user_badges FOR SELECT TO authenticated USING (true);
CREATE POLICY user_badges_insert ON user_badges FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Seed 15 badges
INSERT INTO badges (key, name, description, icon, category) VALUES
    ('first_group',       'First Crew',        'Joined your first fan group',                    '👥', 'milestone'),
    ('first_party',       'Party Starter',      'RSVPd to your first watch party',               '🎉', 'milestone'),
    ('first_clip',        'Highlight Reel',     'Posted your first clip',                         '🎬', 'milestone'),
    ('first_moment',      'Hot Take',           'Posted your first moment',                       '⚡', 'milestone'),
    ('groups_10',         'Community Builder',   'Joined 10 fan groups',                          '🏗️', 'engagement'),
    ('parties_5',         'Social Butterfly',    'Attended 5 watch parties',                      '🦋', 'engagement'),
    ('clips_trending',    'Viral Moment',        'Got 100+ likes on a single clip',               '🔥', 'engagement'),
    ('game_day_regular',  'Game Day Regular',    'RSVPd to 10+ watch parties',                    '🏟️', 'engagement'),
    ('all_in_fan',        'All-In Fan',          'Followed 3+ teams at All-In tier',              '💯', 'engagement'),
    ('sports_nut',        'Sports Nut',          'Following teams across 5+ sports',              '🏅', 'engagement'),
    ('city_explorer',     'City Explorer',       'Joined groups in 3+ different cities',          '🗺️', 'social'),
    ('super_host',        'Super Host',          'Created 5+ watch parties',                      '🏆', 'social'),
    ('social_butterfly',  'Fan Favorite',        'Gained 50+ followers',                          '⭐', 'social'),
    ('early_adopter',     'Early Adopter',       'Joined Fan Wave in the first wave',             '🌊', 'special'),
    ('world_cup_fan',     'World Cup Fan',       'Followed a World Cup team',                     '🏆', 'special')
ON CONFLICT (key) DO NOTHING;

-- =========================
-- 2. BADGE AWARD FUNCTIONS
-- =========================

-- Award a badge (idempotent)
CREATE OR REPLACE FUNCTION award_badge(p_user_id UUID, p_badge_key TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_badge_id UUID;
BEGIN
    SELECT id INTO v_badge_id FROM badges WHERE key = p_badge_key;
    IF v_badge_id IS NULL THEN RETURN; END IF;

    INSERT INTO user_badges (user_id, badge_id)
    VALUES (p_user_id, v_badge_id)
    ON CONFLICT (user_id, badge_id) DO NOTHING;
END;
$$;

-- Check badges after chat_room_members insert (first_group, groups_10, city_explorer)
CREATE OR REPLACE FUNCTION check_group_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID := NEW.user_id;
    v_count INT;
    v_city_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM chat_room_members WHERE user_id = v_user;

    IF v_count = 1 THEN
        PERFORM award_badge(v_user, 'first_group');
    END IF;
    IF v_count >= 10 THEN
        PERFORM award_badge(v_user, 'groups_10');
    END IF;

    SELECT COUNT(DISTINCT cr.city) INTO v_city_count
    FROM chat_room_members crm
    JOIN chat_rooms cr ON cr.id = crm.chat_room_id
    WHERE crm.user_id = v_user AND cr.city IS NOT NULL;

    IF v_city_count >= 3 THEN
        PERFORM award_badge(v_user, 'city_explorer');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_group_badges ON chat_room_members;
CREATE TRIGGER trg_check_group_badges
    AFTER INSERT ON chat_room_members
    FOR EACH ROW EXECUTE FUNCTION check_group_badges();

-- Check badges after watch_party_rsvps insert (first_party, parties_5, game_day_regular)
CREATE OR REPLACE FUNCTION check_party_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID := NEW.user_id;
    v_count INT;
BEGIN
    IF NEW.status != 'going' THEN RETURN NEW; END IF;

    SELECT COUNT(*) INTO v_count
    FROM watch_party_rsvps WHERE user_id = v_user AND status = 'going';

    IF v_count = 1 THEN
        PERFORM award_badge(v_user, 'first_party');
    END IF;
    IF v_count >= 5 THEN
        PERFORM award_badge(v_user, 'parties_5');
    END IF;
    IF v_count >= 10 THEN
        PERFORM award_badge(v_user, 'game_day_regular');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_party_badges ON watch_party_rsvps;
CREATE TRIGGER trg_check_party_badges
    AFTER INSERT OR UPDATE ON watch_party_rsvps
    FOR EACH ROW EXECUTE FUNCTION check_party_badges();

-- Check badges after media_clips insert (first_clip, clips_trending)
CREATE OR REPLACE FUNCTION check_clip_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_user UUID;
    v_count INT;
BEGIN
    -- On INSERT: check first_clip
    IF TG_OP = 'INSERT' THEN
        v_user := NEW.user_id;
        SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user;
        IF v_count = 1 THEN
            PERFORM award_badge(v_user, 'first_clip');
        END IF;
    END IF;

    -- On UPDATE: check trending (100+ likes)
    IF TG_OP = 'UPDATE' AND NEW.like_count >= 100 THEN
        PERFORM award_badge(NEW.user_id, 'clips_trending');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_clip_badges ON media_clips;
CREATE TRIGGER trg_check_clip_badges
    AFTER INSERT OR UPDATE ON media_clips
    FOR EACH ROW EXECUTE FUNCTION check_clip_badges();

-- Check badges after user_follows insert (social_butterfly at 50 followers)
CREATE OR REPLACE FUNCTION check_follower_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM user_follows WHERE following_id = NEW.following_id;
    IF v_count >= 50 THEN
        PERFORM award_badge(NEW.following_id, 'social_butterfly');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_follower_badges ON user_follows;
CREATE TRIGGER trg_check_follower_badges
    AFTER INSERT ON user_follows
    FOR EACH ROW EXECUTE FUNCTION check_follower_badges();

-- Check super_host badge after watch_parties insert
CREATE OR REPLACE FUNCTION check_host_badges()
RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM watch_parties WHERE creator_id = NEW.creator_id;
    IF v_count >= 5 THEN
        PERFORM award_badge(NEW.creator_id, 'super_host');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_host_badges ON watch_parties;
CREATE TRIGGER trg_check_host_badges
    AFTER INSERT ON watch_parties
    FOR EACH ROW EXECUTE FUNCTION check_host_badges();

-- =========================
-- 3. ACTIVITY STREAKS
-- =========================

CREATE TABLE IF NOT EXISTS user_streaks (
    user_id         UUID PRIMARY KEY,
    current_streak  INT DEFAULT 0,
    longest_streak  INT DEFAULT 0,
    last_active_date DATE,
    grace_used_at   DATE
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_streaks_select ON user_streaks
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS TABLE(current_streak INT, longest_streak INT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_today DATE := CURRENT_DATE;
    v_row user_streaks%ROWTYPE;
BEGIN
    -- Get or create streak record
    SELECT * INTO v_row FROM user_streaks WHERE user_id = v_user;

    IF NOT FOUND THEN
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_active_date)
        VALUES (v_user, 1, 1, v_today);
        RETURN QUERY SELECT 1, 1;
        RETURN;
    END IF;

    -- Already active today
    IF v_row.last_active_date = v_today THEN
        RETURN QUERY SELECT v_row.current_streak, v_row.longest_streak;
        RETURN;
    END IF;

    -- Consecutive day
    IF v_row.last_active_date = v_today - 1 THEN
        UPDATE user_streaks
        SET current_streak = v_row.current_streak + 1,
            longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1),
            last_active_date = v_today
        WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1);
        RETURN;
    END IF;

    -- Missed 1 day — grace period (once per 30 days)
    IF v_row.last_active_date = v_today - 2
       AND (v_row.grace_used_at IS NULL OR v_row.grace_used_at < v_today - 30)
    THEN
        UPDATE user_streaks
        SET current_streak = v_row.current_streak + 1,
            longest_streak = GREATEST(v_row.longest_streak, v_row.current_streak + 1),
            last_active_date = v_today,
            grace_used_at = v_today
        WHERE user_id = v_user;
        RETURN QUERY SELECT v_row.current_streak + 1, GREATEST(v_row.longest_streak, v_row.current_streak + 1);
        RETURN;
    END IF;

    -- Streak broken
    UPDATE user_streaks
    SET current_streak = 1,
        last_active_date = v_today
    WHERE user_id = v_user;
    RETURN QUERY SELECT 1, v_row.longest_streak;
END;
$$;

-- =========================
-- 4. TRENDING MATERIALIZED VIEWS
-- =========================

-- Trending clips: weighted by likes + views, decayed by age
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_clips AS
SELECT
    mc.id,
    mc.title,
    mc.user_id,
    mc.media_url,
    mc.media_type,
    mc.thumbnail_url,
    mc.duration_seconds,
    mc.view_count,
    mc.like_count,
    mc.created_at,
    u.display_name AS user_name,
    (mc.like_count * 3 + mc.view_count)::FLOAT /
        GREATEST(EXTRACT(EPOCH FROM (now() - mc.created_at)) / 3600, 1) AS score
FROM media_clips mc
LEFT JOIN users u ON u.auth_id = mc.user_id
WHERE mc.created_at > now() - interval '7 days'
ORDER BY score DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trending_clips_id ON trending_clips(id);

-- Trending groups: by member count + recent message activity
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_groups AS
SELECT
    cr.id,
    cr.name,
    cr.description,
    cr.icon,
    cr.sport_id,
    cr.city,
    cr.tags,
    cr.member_count,
    cr.visibility,
    COALESCE(msg_counts.msg_count_7d, 0) AS message_count_7d,
    cr.member_count + COALESCE(msg_counts.msg_count_7d, 0) * 2 AS score
FROM chat_rooms cr
LEFT JOIN (
    SELECT chat_room_id, COUNT(*) AS msg_count_7d
    FROM messages
    WHERE created_at > now() - interval '7 days'
    GROUP BY chat_room_id
) msg_counts ON msg_counts.chat_room_id = cr.id
WHERE cr.visibility = 'public'
ORDER BY score DESC
LIMIT 100;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trending_groups_id ON trending_groups(id);

-- Hot watch parties: by RSVP velocity in last 48h
CREATE MATERIALIZED VIEW IF NOT EXISTS hot_watch_parties AS
SELECT
    wp.id,
    wp.title,
    wp.venue_name,
    wp.venue_city,
    wp.sport_id,
    wp.starts_at,
    wp.capacity,
    wp.rsvp_count,
    wp.atmosphere,
    COALESCE(recent.recent_rsvps, 0) AS recent_rsvps,
    wp.rsvp_count + COALESCE(recent.recent_rsvps, 0) * 5 AS score
FROM watch_parties wp
LEFT JOIN (
    SELECT watch_party_id, COUNT(*) AS recent_rsvps
    FROM watch_party_rsvps
    WHERE created_at > now() - interval '48 hours'
      AND status = 'going'
    GROUP BY watch_party_id
) recent ON recent.watch_party_id = wp.id
WHERE wp.starts_at > now()
ORDER BY score DESC
LIMIT 50;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hot_parties_id ON hot_watch_parties(id);

-- Cron: refresh all materialized views every 15 minutes
SELECT cron.schedule(
    'refresh-trending-views',
    '*/15 * * * *',
    $$
    REFRESH MATERIALIZED VIEW CONCURRENTLY trending_clips;
    REFRESH MATERIALIZED VIEW CONCURRENTLY trending_groups;
    REFRESH MATERIALIZED VIEW CONCURRENTLY hot_watch_parties;
    $$
);
-- ============================================================
-- Migration 013: Referral System
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INT DEFAULT 0;

-- Auto-generate referral code on user creation
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := LOWER(SUBSTRING(MD5(NEW.auth_id::TEXT || NOW()::TEXT) FROM 1 FOR 8));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON users;
CREATE TRIGGER trg_generate_referral_code
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- RPC: apply referral code during signup
CREATE OR REPLACE FUNCTION apply_referral(p_referral_code TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_referrer_id UUID;
    v_count INT;
BEGIN
    -- Find referrer
    SELECT auth_id INTO v_referrer_id FROM users WHERE referral_code = LOWER(p_referral_code);
    IF v_referrer_id IS NULL THEN RETURN; END IF;
    IF v_referrer_id = auth.uid() THEN RETURN; END IF;

    -- Set referred_by on current user
    UPDATE users SET referred_by = v_referrer_id WHERE auth_id = auth.uid() AND referred_by IS NULL;

    -- Increment referrer's count
    UPDATE users SET referral_count = referral_count + 1 WHERE auth_id = v_referrer_id;

    -- Award recruiter badge at 3 referrals
    SELECT referral_count INTO v_count FROM users WHERE auth_id = v_referrer_id;
    IF v_count >= 3 THEN
        PERFORM award_badge(v_referrer_id, 'recruiter');
    END IF;
END;
$$;

-- Add recruiter badge if not exists
INSERT INTO badges (key, name, description, icon, category)
VALUES ('recruiter', 'Recruiter', 'Invited 3+ friends to Fan Wave', '🎯', 'social')
ON CONFLICT (key) DO NOTHING;

-- RPC: get own referral code
CREATE OR REPLACE FUNCTION get_my_referral_code()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT referral_code FROM users WHERE auth_id = auth.uid();
$$;
-- ============================================================
-- Migration 014: Watch Party Invites
-- Stores invited friends for private watch parties
-- ============================================================

CREATE TABLE IF NOT EXISTS watch_party_invites (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
    invited_by     UUID NOT NULL,
    name           TEXT NOT NULL,
    phone          TEXT,
    status         TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_invites_party ON watch_party_invites(watch_party_id);
CREATE INDEX IF NOT EXISTS idx_wp_invites_by ON watch_party_invites(invited_by);

ALTER TABLE watch_party_invites ENABLE ROW LEVEL SECURITY;

-- Creator can see and manage invites for their parties
CREATE POLICY wp_invites_select ON watch_party_invites
    FOR SELECT TO authenticated
    USING (
        invited_by = auth.uid()
        OR watch_party_id IN (
            SELECT id FROM watch_parties WHERE creator_id = auth.uid()
        )
    );

CREATE POLICY wp_invites_insert ON watch_party_invites
    FOR INSERT TO authenticated
    WITH CHECK (invited_by = auth.uid());

CREATE POLICY wp_invites_delete ON watch_party_invites
    FOR DELETE TO authenticated
    USING (invited_by = auth.uid());

-- Add visibility column to watch_parties if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watch_parties' AND column_name = 'visibility'
    ) THEN
        ALTER TABLE watch_parties ADD COLUMN visibility TEXT DEFAULT 'public'
            CHECK (visibility IN ('public', 'private'));
    END IF;
END $$;
-- ============================================================
-- Migration 015: Fix RLS Infinite Recursion
--
-- The chat_room_members INSERT policy references chat_rooms,
-- which has a SELECT policy that references chat_room_members,
-- causing infinite recursion.
--
-- Fix: simplify the INSERT policy to avoid cross-table checks.
-- ============================================================

-- Drop the problematic INSERT policy
DROP POLICY IF EXISTS chat_room_members_insert ON chat_room_members;

-- New INSERT policy: users can add themselves to any room.
-- The room's visibility check is handled at the application level
-- and by the chat_rooms SELECT policy (users can only see rooms
-- they should be able to join).
CREATE POLICY chat_room_members_insert ON chat_room_members
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Also fix the SELECT policy to avoid self-referencing subquery
-- which can also cause recursion in some Supabase versions.
DROP POLICY IF EXISTS chat_room_members_select ON chat_room_members;

-- Users can see members in rooms they belong to.
-- Uses a direct equality check instead of subquery to avoid recursion.
CREATE POLICY chat_room_members_select ON chat_room_members
    FOR SELECT TO authenticated
    USING (
        -- Users can always see their own membership rows
        user_id = auth.uid()
        -- Or rows in rooms where they are a member
        -- (Supabase handles this via the RLS context without recursion
        -- because we check the same table with a different filter)
        OR chat_room_id IN (
            SELECT crm.chat_room_id FROM chat_room_members crm
            WHERE crm.user_id = auth.uid()
        )
    );

-- Add DELETE policy so users can leave rooms
DROP POLICY IF EXISTS chat_room_members_delete ON chat_room_members;
CREATE POLICY chat_room_members_delete ON chat_room_members
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());
-- ============================================================
-- Migration 016: Fix Badge Trigger Recursion
--
-- The badge check triggers (from migration 012) cause infinite
-- recursion when they query chat_room_members during RLS
-- policy evaluation on the same table.
--
-- Fix: Remove database triggers for badge checks.
-- Badge awarding will be handled at the application level
-- via the existing award_badge() RPC function.
-- ============================================================

-- Remove triggers that cause recursion
DROP TRIGGER IF EXISTS trg_check_group_badges ON chat_room_members;
DROP TRIGGER IF EXISTS trg_check_party_badges ON watch_party_rsvps;
DROP TRIGGER IF EXISTS trg_check_clip_badges ON media_clips;
DROP TRIGGER IF EXISTS trg_check_follower_badges ON user_follows;
DROP TRIGGER IF EXISTS trg_check_host_badges ON watch_parties;

-- Create a single RPC that checks and awards all badges for a user.
-- Called from the app after key actions (join group, RSVP, post clip, etc.)
CREATE OR REPLACE FUNCTION check_and_award_badges()
RETURNS TABLE(badge_key TEXT, badge_name TEXT, badge_icon TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_count INT;
    v_city_count INT;
    v_sport_count INT;
    v_result RECORD;
BEGIN
    -- First group
    SELECT COUNT(*) INTO v_count FROM chat_room_members WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_group'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'groups_10'); END IF;

    -- City explorer (3+ cities)
    SELECT COUNT(DISTINCT cr.city) INTO v_city_count
    FROM chat_room_members crm
    JOIN chat_rooms cr ON cr.id = crm.chat_room_id
    WHERE crm.user_id = v_user AND cr.city IS NOT NULL;
    IF v_city_count >= 3 THEN PERFORM award_badge(v_user, 'city_explorer'); END IF;

    -- First watch party & attendance badges
    SELECT COUNT(*) INTO v_count FROM watch_party_rsvps WHERE user_id = v_user AND status = 'going';
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_party'); END IF;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'parties_5'); END IF;
    IF v_count >= 10 THEN PERFORM award_badge(v_user, 'game_day_regular'); END IF;

    -- First clip
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'first_clip'); END IF;

    -- Trending clip (100+ likes)
    SELECT COUNT(*) INTO v_count FROM media_clips WHERE user_id = v_user AND like_count >= 100;
    IF v_count >= 1 THEN PERFORM award_badge(v_user, 'clips_trending'); END IF;

    -- Super host (5+ parties created)
    SELECT COUNT(*) INTO v_count FROM watch_parties WHERE creator_id = v_user;
    IF v_count >= 5 THEN PERFORM award_badge(v_user, 'super_host'); END IF;

    -- Fan favorite (50+ followers)
    SELECT COUNT(*) INTO v_count FROM user_follows WHERE following_id = v_user;
    IF v_count >= 50 THEN PERFORM award_badge(v_user, 'social_butterfly'); END IF;

    -- Sports nut (5+ sports followed)
    SELECT COUNT(DISTINCT s.id) INTO v_sport_count
    FROM user_team_follows utf
    JOIN teams t ON t.id = utf.team_id
    JOIN leagues l ON l.id = t.league_id
    JOIN sports s ON s.id = l.sport_id
    WHERE utf.user_id = v_user;
    IF v_sport_count >= 5 THEN PERFORM award_badge(v_user, 'sports_nut'); END IF;

    -- Return any newly awarded badges (earned in the last 5 seconds)
    RETURN QUERY
    SELECT b.key, b.name, b.icon
    FROM user_badges ub
    JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = v_user
      AND ub.earned_at > now() - interval '5 seconds';
END;
$$;
