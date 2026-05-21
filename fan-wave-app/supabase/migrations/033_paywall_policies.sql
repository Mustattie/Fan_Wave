-- 033: paywall RLS policies on writes.
-- Layers has_premium_access() (migration 032) on top of existing
-- entitlement-agnostic INSERT policies, with WC-specific has_wc_access()
-- on the subset of writes that touch WC content. Defence-in-depth: even
-- if the client paywall is bypassed, the DB rejects.
--
-- WC constants used inline below:
--   WC League ID: 'b0000000-0000-0000-0000-000000000026'
--   WC Event ID:  'e0000000-0000-0000-0000-000000002026'
--   chat_rooms.group_type 'worldcup' is the WC group marker.
--
-- Pattern: DROP existing INSERT policy + CREATE new one with the same
-- ownership check plus entitlement check appended. (Cannot ADD a parallel
-- policy — PostgreSQL ORs policies of the same role/command together,
-- which would WEAKEN security here.)

-- ─── 1. chat_rooms — gate room creation behind premium; WC groups
--      additionally require has_wc_access ────────────────────────────
DROP POLICY IF EXISTS chat_rooms_insert ON chat_rooms;
CREATE POLICY chat_rooms_insert ON chat_rooms
    FOR INSERT TO authenticated
    WITH CHECK (
        owner_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            group_type IS DISTINCT FROM 'worldcup'
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── 2. chat_room_members — joining a WC group requires WC access ──
DROP POLICY IF EXISTS chat_room_members_insert ON chat_room_members;
CREATE POLICY chat_room_members_insert ON chat_room_members
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            (SELECT cr.group_type FROM public.chat_rooms cr WHERE cr.id = chat_room_id)
              IS DISTINCT FROM 'worldcup'
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── 3. messages — gate chat send; also blocks cancelled users ──────
-- Preserve the membership check from migration 017 (user must already
-- be a member of the room to message). Inlines the membership subquery
-- since `public.user_chat_room_ids()` isn't present on the remote DB
-- — migration 026 already used this pattern as a workaround.
DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND chat_room_id IN (
            SELECT chat_room_id FROM public.chat_room_members
            WHERE user_id = auth.uid()
        )
    );

-- ─── 4. watch_parties — gate creation; WC parties require WC access ─
DROP POLICY IF EXISTS watch_parties_insert ON watch_parties;
CREATE POLICY watch_parties_insert ON watch_parties
    FOR INSERT TO authenticated
    WITH CHECK (
        creator_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            event_id IS DISTINCT FROM 'e0000000-0000-0000-0000-000000002026'::UUID
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── 5. watch_party_rsvps — RSVPing a WC party requires WC access ──
DROP POLICY IF EXISTS watch_party_rsvps_insert ON watch_party_rsvps;
CREATE POLICY watch_party_rsvps_insert ON watch_party_rsvps
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            (SELECT wp.event_id FROM public.watch_parties wp WHERE wp.id = watch_party_id)
              IS DISTINCT FROM 'e0000000-0000-0000-0000-000000002026'::UUID
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── 6. match_moments — posting in a WC group requires WC access ────
DROP POLICY IF EXISTS match_moments_insert ON match_moments;
CREATE POLICY match_moments_insert ON match_moments
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            (SELECT cr.group_type FROM public.chat_rooms cr WHERE cr.id = chat_room_id)
              IS DISTINCT FROM 'worldcup'
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── 7. media_clips — gate clip posting behind premium ─────────────
DROP POLICY IF EXISTS media_clips_insert ON media_clips;
CREATE POLICY media_clips_insert ON media_clips
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
    );

-- ─── 8. user_team_follows — following a WC national team requires
--      WC access (national teams are members of the WC league) ──────
DROP POLICY IF EXISTS "Users can insert own follows" ON user_team_follows;
CREATE POLICY "Users can insert own follows" ON user_team_follows
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND (
            (SELECT t.league_id FROM public.teams t WHERE t.id = team_id)
              IS DISTINCT FROM 'b0000000-0000-0000-0000-000000000026'::UUID
            OR public.has_wc_access(auth.uid())
        )
    );

-- ─── Verification queries (run manually as a smoke test) ────────────
-- After apply, for a known user where subscription_status='none':
--
--   -- Should INSERT successfully if premium / WC where required
--   SELECT public.has_premium_access('<auth-uid>'::uuid);
--   SELECT public.has_wc_access('<auth-uid>'::uuid);
--
--   -- Negative: simulate the policy WITH CHECK by trying an INSERT
--   -- as a non-entitled user — expect "new row violates row-level
--   -- security policy" error
--   INSERT INTO media_clips (user_id, title, media_url, media_type)
--   VALUES ('<auth-uid>'::uuid, 'test', 'http://x.com/v.mp4', 'video');
