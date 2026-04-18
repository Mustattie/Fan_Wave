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
