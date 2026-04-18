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
