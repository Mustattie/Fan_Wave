-- Migration 017: Scalability Fixes
-- Addresses: connection pooling prep, missing indexes, unbounded RPCs, RLS optimization

-- ============================================================================
-- 1. MISSING COMPOSITE INDEXES (D6)
-- ============================================================================

-- Clips feed ordering
CREATE INDEX IF NOT EXISTS idx_media_clips_created_desc
    ON media_clips (created_at DESC);

-- Analytics queries (prevent full scans on growing table)
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_desc
    ON analytics_events (created_at DESC);

-- Notification dedup lookups in trigger-notifications edge function
CREATE INDEX IF NOT EXISTS idx_notification_log_ref_type
    ON notification_log (ref_id, type);

-- Discover screen time-range queries
CREATE INDEX IF NOT EXISTS idx_watch_parties_starts_at
    ON watch_parties (starts_at);

-- ============================================================================
-- 2. ADD PAGINATION TO browse_public_groups RPC (D4)
-- ============================================================================

CREATE OR REPLACE FUNCTION browse_public_groups(
    p_city     TEXT,
    p_sport_id UUID    DEFAULT NULL,
    p_search   TEXT    DEFAULT NULL,
    p_limit    INT     DEFAULT 50,
    p_offset   INT     DEFAULT 0
)
RETURNS SETOF chat_rooms
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM chat_rooms
     WHERE visibility = 'public'
       AND (p_city IS NULL     OR city = p_city)
       AND (p_sport_id IS NULL OR sport_id = p_sport_id)
       AND (p_search IS NULL   OR name ILIKE '%' || p_search || '%')
     ORDER BY member_count DESC
     LIMIT p_limit
    OFFSET p_offset;
$$;

-- ============================================================================
-- 3. OPTIMIZE messages_select RLS POLICY (D5)
--    Create a STABLE SECURITY DEFINER helper so Postgres can cache the
--    user's room list within a single transaction instead of re-evaluating
--    the subquery per row.
-- ============================================================================

CREATE OR REPLACE FUNCTION user_chat_room_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT chat_room_id
      FROM chat_room_members
     WHERE user_id = auth.uid();
$$;

-- Replace the original messages_select policy with the optimized version
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
    FOR SELECT TO authenticated
    USING (
        chat_room_id IN (SELECT user_chat_room_ids())
    );

-- Also optimize the messages_insert policy which has the same subquery
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND chat_room_id IN (SELECT user_chat_room_ids())
    );

-- ============================================================================
-- 4. CREATE VIEW FOR WATCH PARTY DETAIL (D2)
--    Joins watch_parties with sport name and creator display_name
--    so the app can fetch everything in a single query.
-- ============================================================================

CREATE OR REPLACE VIEW watch_party_details AS
SELECT
    wp.*,
    s.name AS sport_name,
    u.display_name AS creator_name
FROM watch_parties wp
LEFT JOIN sports s ON s.id = wp.sport_id
LEFT JOIN users u ON u.auth_id = wp.creator_id;

-- RPC to fetch attendees with display names in one call (D2)
CREATE OR REPLACE FUNCTION get_watch_party_attendees(p_party_id UUID)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    status TEXT,
    display_name TEXT
)
LANGUAGE sql STABLE
AS $$
    SELECT
        r.id,
        r.user_id,
        r.status,
        COALESCE(u.display_name, 'User') AS display_name
    FROM watch_party_rsvps r
    LEFT JOIN users u ON u.auth_id = r.user_id
    WHERE r.watch_party_id = p_party_id
      AND r.status IN ('going', 'interested')
    ORDER BY r.created_at;
$$;
