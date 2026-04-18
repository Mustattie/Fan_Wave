-- 004_moments_clips_moderation.sql
-- Clip engagement, content moderation, user blocks, and analytics.
-- Depends on: 002_chat_schema.sql (media_clips, match_moments, moment_reactions, chat_rooms)

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE clip_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clip_id    UUID NOT NULL REFERENCES media_clips(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    content    TEXT NOT NULL CHECK (char_length(content) <= 500),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE clip_likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clip_id    UUID NOT NULL REFERENCES media_clips(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (clip_id, user_id)
);

CREATE TABLE content_flags (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type TEXT NOT NULL CHECK (content_type IN ('watch_party','chat_room','media_clip','moment','message')),
    content_id   UUID NOT NULL,
    flagger_id   UUID NOT NULL,
    reason       TEXT NOT NULL CHECK (reason IN ('spam','inappropriate','harassment','misleading','safety','other')),
    details      TEXT DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (content_type, content_id, flagger_id)
);

CREATE TABLE moderation_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action       TEXT NOT NULL,
    content_type TEXT,
    content_id   UUID,
    performed_by UUID NOT NULL,
    details      JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE banned_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    banned_by    UUID NOT NULL,
    reason       TEXT DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE (chat_room_id, user_id)
);

CREATE TABLE user_blocks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL,
    blocked_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE analytics_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID,
    event_name TEXT NOT NULL,
    screen     TEXT,
    metadata   JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_clip_comments_clip_created
    ON clip_comments (clip_id, created_at);

CREATE INDEX idx_clip_likes_clip
    ON clip_likes (clip_id);

CREATE INDEX idx_content_flags_type_id
    ON content_flags (content_type, content_id);

CREATE INDEX idx_analytics_events_user_created
    ON analytics_events (user_id, created_at);

CREATE INDEX idx_analytics_events_name
    ON analytics_events (event_name);

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE clip_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_likes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_flags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE banned_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- ---- clip_comments ------------------------------------------------

CREATE POLICY clip_comments_select ON clip_comments
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY clip_comments_insert ON clip_comments
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY clip_comments_delete ON clip_comments
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- ---- clip_likes ---------------------------------------------------

CREATE POLICY clip_likes_select ON clip_likes
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY clip_likes_insert ON clip_likes
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY clip_likes_delete ON clip_likes
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- ---- content_flags ------------------------------------------------

-- Users can see their own flags.
CREATE POLICY content_flags_select ON content_flags
    FOR SELECT TO authenticated
    USING (flagger_id = auth.uid());

CREATE POLICY content_flags_insert ON content_flags
    FOR INSERT TO authenticated
    WITH CHECK (flagger_id = auth.uid());

-- ---- moderation_log -----------------------------------------------

-- Admin-only read. Uses a helper check against chat_room_members role.
-- For a global admin role, replace with your own admin lookup.
CREATE POLICY moderation_log_select ON moderation_log
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM chat_room_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin')
        )
    );

-- ---- banned_members -----------------------------------------------

CREATE POLICY banned_members_select ON banned_members
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY banned_members_insert ON banned_members
    FOR INSERT TO authenticated
    WITH CHECK (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin')
        )
    );

CREATE POLICY banned_members_delete ON banned_members
    FOR DELETE TO authenticated
    USING (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
              AND role IN ('owner', 'admin')
        )
    );

-- ---- user_blocks --------------------------------------------------

CREATE POLICY user_blocks_select ON user_blocks
    FOR SELECT TO authenticated
    USING (blocker_id = auth.uid());

CREATE POLICY user_blocks_insert ON user_blocks
    FOR INSERT TO authenticated
    WITH CHECK (blocker_id = auth.uid());

CREATE POLICY user_blocks_delete ON user_blocks
    FOR DELETE TO authenticated
    USING (blocker_id = auth.uid());

-- ---- analytics_events ---------------------------------------------

-- Users can read their own events.
CREATE POLICY analytics_events_select ON analytics_events
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY analytics_events_insert ON analytics_events
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. TRIGGER FUNCTIONS
-- ============================================================

-- Keep media_clips.like_count in sync with clip_likes rows.
CREATE OR REPLACE FUNCTION increment_clip_like_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE media_clips
       SET like_count = like_count + 1
     WHERE id = NEW.clip_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_clip_like_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE media_clips
       SET like_count = GREATEST(like_count - 1, 0)
     WHERE id = OLD.clip_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_clip_like_insert
    AFTER INSERT ON clip_likes
    FOR EACH ROW EXECUTE FUNCTION increment_clip_like_count();

CREATE TRIGGER trg_clip_like_delete
    AFTER DELETE ON clip_likes
    FOR EACH ROW EXECUTE FUNCTION decrement_clip_like_count();

-- ============================================================
-- 5. RPC FUNCTIONS
-- ============================================================

-- Toggle a reaction on a match moment.
-- Returns the new row if inserted, or null if deleted.
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
    SELECT id INTO v_existing_id
      FROM moment_reactions
     WHERE moment_id = p_moment_id
       AND user_id   = p_user_id
       AND emoji     = p_emoji;

    IF v_existing_id IS NOT NULL THEN
        DELETE FROM moment_reactions WHERE id = v_existing_id;
        -- Return empty set (null)
        RETURN;
    ELSE
        RETURN QUERY
            INSERT INTO moment_reactions (moment_id, user_id, emoji)
            VALUES (p_moment_id, p_user_id, p_emoji)
            RETURNING *;
    END IF;
END;
$$;

-- Flag content and auto-escalate when threshold is reached.
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

        -- Mark content based on type
        IF p_type = 'watch_party' THEN
            UPDATE watch_parties
               SET moderation_status = 'flagged'
             WHERE id = p_content_id;
        END IF;
        -- Additional content types can be handled here as moderation_status
        -- columns are added to those tables.
    END IF;

    RETURN v_flag_id;
END;
$$;

-- Toggle a like on a media clip. Returns true if liked, false if unliked.
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
    SELECT id INTO v_existing_id
      FROM clip_likes
     WHERE clip_id = p_clip_id
       AND user_id = p_user_id;

    IF v_existing_id IS NOT NULL THEN
        DELETE FROM clip_likes WHERE id = v_existing_id;
        -- like_count decremented by trigger
        RETURN false;
    ELSE
        INSERT INTO clip_likes (clip_id, user_id)
        VALUES (p_clip_id, p_user_id);
        -- like_count incremented by trigger
        RETURN true;
    END IF;
END;
$$;

-- Get trending clips, optionally filtered by sport.
CREATE OR REPLACE FUNCTION get_trending_clips(
    p_sport_id UUID DEFAULT NULL,
    p_limit    INT  DEFAULT 20,
    p_offset   INT  DEFAULT 0
)
RETURNS SETOF media_clips
LANGUAGE sql STABLE
AS $$
    SELECT mc.*
      FROM media_clips mc
      LEFT JOIN chat_rooms cr ON cr.id = mc.chat_room_id
     WHERE (p_sport_id IS NULL OR cr.sport_id = p_sport_id)
     ORDER BY (mc.like_count + mc.view_count) DESC
     LIMIT p_limit
    OFFSET p_offset;
$$;
