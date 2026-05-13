-- ============================================================================
-- 026_block_user.sql
--
-- Block-user feature (App Store / Play Store soft-requirement for UGC apps).
--
-- Data model:
--   user_blocks (blocker_id, blocked_id)  — one row per direction
--
-- Helper:
--   blocked_user_ids()  — every auth_id in either direction relative to me
--
-- RLS update:
--   media_clips_select, messages_select, watch_parties_select now exclude
--   any rows authored by a user with whom I have a block relationship
--   (bidirectional — blocker and blockee both lose visibility).
--
-- RPCs:
--   block_user(p_blocked_id)
--   unblock_user(p_blocked_id)
--   get_my_blocks()  — list of users I have blocked, with display_name
-- ============================================================================

-- 1. user_blocks table
CREATE TABLE IF NOT EXISTS user_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  UUID NOT NULL,
    blocked_id  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

-- Users can only see their own block rows
DROP POLICY IF EXISTS user_blocks_select ON user_blocks;
CREATE POLICY user_blocks_select ON user_blocks
    FOR SELECT TO authenticated
    USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_blocks_insert ON user_blocks;
CREATE POLICY user_blocks_insert ON user_blocks
    FOR INSERT TO authenticated
    WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS user_blocks_delete ON user_blocks;
CREATE POLICY user_blocks_delete ON user_blocks
    FOR DELETE TO authenticated
    USING (blocker_id = auth.uid());

-- 2. Helper: returns every auth_id with whom I have a block relationship.
--    SECURITY DEFINER so it can read past the user_blocks RLS for the
--    "blocked_id = auth.uid()" direction.
CREATE OR REPLACE FUNCTION blocked_user_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT blocked_id FROM user_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id FROM user_blocks WHERE blocked_id = auth.uid()
$$;

-- 3. Tighten RLS on user-authored content to honour blocks.

-- media_clips: was USING (true); now hide content from blocked relationships.
DROP POLICY IF EXISTS media_clips_select ON media_clips;
CREATE POLICY media_clips_select ON media_clips
    FOR SELECT TO authenticated
    USING (
        user_id NOT IN (SELECT blocked_user_ids())
    );

-- messages: keep chat-room membership requirement, add block filter.
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (SELECT user_chat_room_ids())
        AND user_id NOT IN (SELECT blocked_user_ids())
    );

-- watch_parties: hide parties whose creator I have blocked (or who blocked me).
DROP POLICY IF EXISTS watch_parties_select ON watch_parties;
CREATE POLICY watch_parties_select ON watch_parties
    FOR SELECT TO authenticated
    USING (
        (moderation_status != 'removed' OR creator_id = auth.uid())
        AND creator_id NOT IN (SELECT blocked_user_ids())
    );

-- 4. RPCs

-- Block a user by their auth.uid(). Idempotent.
CREATE OR REPLACE FUNCTION block_user(p_blocked_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_blocked_id IS NULL THEN
        RAISE EXCEPTION 'blocked_id is required';
    END IF;
    IF p_blocked_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot block yourself';
    END IF;

    INSERT INTO user_blocks (blocker_id, blocked_id)
    VALUES (auth.uid(), p_blocked_id)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
END;
$$;

-- Unblock a user. Idempotent.
CREATE OR REPLACE FUNCTION unblock_user(p_blocked_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    DELETE FROM user_blocks
    WHERE blocker_id = auth.uid() AND blocked_id = p_blocked_id;
$$;

-- List users I have blocked, with display name and when.
CREATE OR REPLACE FUNCTION get_my_blocks()
RETURNS TABLE (
    blocked_id    UUID,
    display_name  TEXT,
    blocked_at    TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        ub.blocked_id,
        COALESCE(u.display_name, 'User') AS display_name,
        ub.created_at AS blocked_at
    FROM user_blocks ub
    LEFT JOIN users u ON u.auth_id = ub.blocked_id
    WHERE ub.blocker_id = auth.uid()
    ORDER BY ub.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION block_user(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION unblock_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_blocks()    TO authenticated;
GRANT EXECUTE ON FUNCTION blocked_user_ids() TO authenticated;

NOTIFY pgrst, 'reload schema';
