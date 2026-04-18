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
