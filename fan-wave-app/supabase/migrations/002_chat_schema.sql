-- 002_chat_schema.sql
-- Chat rooms, messages, watch parties, match moments, and media clips.
-- Depends on: 001_base_schema.sql (sports, leagues, teams, events, games)
-- Assumes: auth.uid() available, users table exists.

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE chat_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    group_type  TEXT NOT NULL CHECK (group_type IN ('sports','worldcup','general')),
    sport_id    UUID REFERENCES sports(id),
    event_id    UUID REFERENCES events(id),
    team_id     UUID REFERENCES teams(id),
    city        TEXT,
    tags        TEXT[] DEFAULT '{}',
    visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
    owner_id    UUID NOT NULL,
    member_count INT DEFAULT 0,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_room_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    joined_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (chat_room_id, user_id)
);

CREATE TABLE messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    type         TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','image','video','moment')),
    metadata     JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE watch_parties (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id        UUID NOT NULL,
    game_id           UUID REFERENCES games(id),
    sport_id          UUID REFERENCES sports(id),
    event_id          UUID REFERENCES events(id),
    title             TEXT NOT NULL,
    description       TEXT DEFAULT '',
    venue_name        TEXT NOT NULL,
    venue_address     TEXT DEFAULT '',
    venue_lat         FLOAT,
    venue_lon         FLOAT,
    venue_city        TEXT,
    atmosphere        TEXT DEFAULT 'moderate' CHECK (atmosphere IN ('chill','moderate','loud','rowdy')),
    capacity          INT DEFAULT 50,
    rsvp_count        INT DEFAULT 0,
    starts_at         TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT now(),
    moderation_status TEXT DEFAULT 'active' CHECK (moderation_status IN ('active','flagged','removed'))
);

CREATE TABLE watch_party_rsvps (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL,
    status         TEXT NOT NULL DEFAULT 'going' CHECK (status IN ('going','interested','declined')),
    created_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (watch_party_id, user_id)
);

CREATE TABLE match_moments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id UUID REFERENCES chat_rooms(id),
    game_id      UUID REFERENCES games(id),
    user_id      UUID NOT NULL,
    moment_type  TEXT NOT NULL,
    minute       TEXT,
    team_id      UUID REFERENCES teams(id),
    comment      TEXT DEFAULT '',
    media_url    TEXT,
    is_pinned    BOOLEAN DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE moment_reactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id  UUID NOT NULL REFERENCES match_moments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (moment_id, user_id, emoji)
);

CREATE TABLE media_clips (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_room_id     UUID REFERENCES chat_rooms(id),
    game_id          UUID REFERENCES games(id),
    user_id          UUID NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT DEFAULT '',
    media_url        TEXT NOT NULL,
    media_type       TEXT NOT NULL DEFAULT 'video' CHECK (media_type IN ('video','image')),
    thumbnail_url    TEXT,
    duration_seconds INT,
    view_count       INT DEFAULT 0,
    like_count       INT DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_messages_room_created
    ON messages (chat_room_id, created_at);

CREATE INDEX idx_chat_room_members_user
    ON chat_room_members (user_id);

CREATE INDEX idx_watch_parties_city_starts
    ON watch_parties (venue_city, starts_at);

CREATE INDEX idx_media_clips_room_created
    ON media_clips (chat_room_id, created_at);

-- ============================================================
-- 3. ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE chat_rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_room_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE watch_parties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE watch_party_rsvps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_moments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE moment_reactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_clips         ENABLE ROW LEVEL SECURITY;

-- ---- chat_rooms ------------------------------------------------

-- Public rooms are visible to every authenticated user.
CREATE POLICY chat_rooms_select_public ON chat_rooms
    FOR SELECT TO authenticated
    USING (visibility = 'public');

-- Private rooms are visible only to their members.
CREATE POLICY chat_rooms_select_private ON chat_rooms
    FOR SELECT TO authenticated
    USING (
        visibility = 'private'
        AND id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- Any authenticated user can create a room (they become the owner).
CREATE POLICY chat_rooms_insert ON chat_rooms
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());

-- ---- chat_room_members -----------------------------------------

-- Members can see other members in rooms they belong to.
CREATE POLICY chat_room_members_select ON chat_room_members
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- Users can add themselves to public rooms or rooms they are invited to.
CREATE POLICY chat_room_members_insert ON chat_room_members
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND (
            -- public room: anyone can join
            EXISTS (
                SELECT 1 FROM chat_rooms
                WHERE chat_rooms.id = chat_room_id AND visibility = 'public'
            )
            -- private room: user must already be a member (invited)
            OR EXISTS (
                SELECT 1 FROM chat_room_members AS existing
                WHERE existing.chat_room_id = chat_room_members.chat_room_id
                  AND existing.user_id = auth.uid()
            )
        )
    );

-- ---- messages ---------------------------------------------------

-- Members of a room can read its messages.
CREATE POLICY messages_select ON messages
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- Members of a room can insert messages.
CREATE POLICY messages_insert ON messages
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND chat_room_id IN (
            SELECT chat_room_id FROM chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- ---- watch_parties ----------------------------------------------

-- All authenticated users can browse watch parties.
CREATE POLICY watch_parties_select ON watch_parties
    FOR SELECT TO authenticated
    USING (true);

-- Creator can insert their own watch parties.
CREATE POLICY watch_parties_insert ON watch_parties
    FOR INSERT TO authenticated
    WITH CHECK (creator_id = auth.uid());

-- Creator can update their own watch parties.
CREATE POLICY watch_parties_update ON watch_parties
    FOR UPDATE TO authenticated
    USING (creator_id = auth.uid())
    WITH CHECK (creator_id = auth.uid());

-- ---- watch_party_rsvps ------------------------------------------

-- Authenticated users can read RSVPs.
CREATE POLICY watch_party_rsvps_select ON watch_party_rsvps
    FOR SELECT TO authenticated
    USING (true);

-- Users can insert their own RSVP.
CREATE POLICY watch_party_rsvps_insert ON watch_party_rsvps
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can update their own RSVP.
CREATE POLICY watch_party_rsvps_update ON watch_party_rsvps
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ---- match_moments ----------------------------------------------

CREATE POLICY match_moments_select ON match_moments
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY match_moments_insert ON match_moments
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ---- moment_reactions -------------------------------------------

CREATE POLICY moment_reactions_select ON moment_reactions
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY moment_reactions_insert ON moment_reactions
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ---- media_clips ------------------------------------------------

CREATE POLICY media_clips_select ON media_clips
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY media_clips_insert ON media_clips
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. TRIGGER FUNCTIONS
-- ============================================================

-- member_count on chat_rooms
CREATE OR REPLACE FUNCTION increment_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = member_count + 1
     WHERE id = NEW.chat_room_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_member_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_rooms
       SET member_count = GREATEST(member_count - 1, 0)
     WHERE id = OLD.chat_room_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_chat_room_member_insert
    AFTER INSERT ON chat_room_members
    FOR EACH ROW EXECUTE FUNCTION increment_member_count();

CREATE TRIGGER trg_chat_room_member_delete
    AFTER DELETE ON chat_room_members
    FOR EACH ROW EXECUTE FUNCTION decrement_member_count();

-- rsvp_count on watch_parties
CREATE OR REPLACE FUNCTION increment_rsvp_count()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'going' THEN
        UPDATE watch_parties
           SET rsvp_count = rsvp_count + 1
         WHERE id = NEW.watch_party_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_rsvp_count()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'going' THEN
        UPDATE watch_parties
           SET rsvp_count = GREATEST(rsvp_count - 1, 0)
         WHERE id = OLD.watch_party_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_watch_party_rsvp_insert
    AFTER INSERT ON watch_party_rsvps
    FOR EACH ROW EXECUTE FUNCTION increment_rsvp_count();

CREATE TRIGGER trg_watch_party_rsvp_delete
    AFTER DELETE ON watch_party_rsvps
    FOR EACH ROW EXECUTE FUNCTION decrement_rsvp_count();

-- ============================================================
-- 5. DATABASE FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION browse_public_groups(
    p_city    TEXT,
    p_sport_id UUID DEFAULT NULL,
    p_search   TEXT DEFAULT NULL
)
RETURNS SETOF chat_rooms
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM chat_rooms
     WHERE visibility = 'public'
       AND (p_city IS NULL    OR city = p_city)
       AND (p_sport_id IS NULL OR sport_id = p_sport_id)
       AND (p_search IS NULL  OR name ILIKE '%' || p_search || '%')
     ORDER BY member_count DESC;
$$;
