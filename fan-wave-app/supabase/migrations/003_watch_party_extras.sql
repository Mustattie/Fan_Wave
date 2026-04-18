-- 003_watch_party_extras.sql
-- Watch party flags, RPC functions, and additional RLS policies.
-- Depends on: 002_chat_schema.sql (watch_parties, watch_party_rsvps)

-- ============================================================
-- 1. TABLES
-- ============================================================

CREATE TABLE watch_party_flags (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_party_id UUID NOT NULL REFERENCES watch_parties(id) ON DELETE CASCADE,
    flagger_id     UUID NOT NULL,
    reason         TEXT NOT NULL CHECK (reason IN ('spam','inappropriate','misleading','safety','other')),
    details        TEXT DEFAULT '',
    created_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE (watch_party_id, flagger_id)
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

CREATE INDEX idx_watch_party_flags_party
    ON watch_party_flags (watch_party_id);

-- ============================================================
-- 3. ROW-LEVEL SECURITY — watch_party_flags
-- ============================================================

ALTER TABLE watch_party_flags ENABLE ROW LEVEL SECURITY;

-- Authenticated users can insert their own flags.
CREATE POLICY watch_party_flags_insert ON watch_party_flags
    FOR INSERT TO authenticated
    WITH CHECK (flagger_id = auth.uid());

-- No public SELECT policy — flags are admin-only.

-- ============================================================
-- 4. ADDITIONAL RLS — watch_parties (hide removed parties)
-- ============================================================

-- Drop the existing blanket SELECT policy so we can replace it
-- with one that hides removed parties.
DROP POLICY IF EXISTS watch_parties_select ON watch_parties;

-- Everyone can see active/flagged parties; creators can still
-- see their own even when removed.
CREATE POLICY watch_parties_select ON watch_parties
    FOR SELECT TO authenticated
    USING (
        moderation_status != 'removed'
        OR creator_id = auth.uid()
    );

-- ============================================================
-- 5. RPC FUNCTIONS
-- ============================================================

-- 5a. rsvp_to_watch_party ----------------------------------------

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

-- 5b. flag_watch_party --------------------------------------------

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

-- 5c. get_watch_parties -------------------------------------------

CREATE OR REPLACE FUNCTION get_watch_parties(
    p_city      TEXT,
    p_sport_id  UUID        DEFAULT NULL,
    p_date_from TIMESTAMPTZ DEFAULT now(),
    p_date_to   TIMESTAMPTZ DEFAULT now() + interval '7 days'
)
RETURNS SETOF watch_parties
LANGUAGE sql STABLE
AS $$
    SELECT *
      FROM watch_parties
     WHERE venue_city ILIKE p_city
       AND starts_at BETWEEN p_date_from AND p_date_to
       AND moderation_status = 'active'
       AND (p_sport_id IS NULL OR sport_id = p_sport_id)
     ORDER BY starts_at ASC;
$$;
