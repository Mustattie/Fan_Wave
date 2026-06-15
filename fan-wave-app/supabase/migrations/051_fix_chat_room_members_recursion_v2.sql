-- 051: SECOND fix for chat_room_members RLS infinite recursion
--
-- Migration 015 fixed half of the loop (the INSERT path) but the SELECT-side
-- self-reference + chat_rooms_select_private cross-reference re-introduced
-- it. Migration 033 (paywall_policies) further reopened the loop by inlining
-- `SELECT cr.group_type FROM chat_rooms cr WHERE cr.id = chat_room_id` inside
-- chat_room_members_insert's WITH CHECK — that scalar subquery re-enters
-- chat_rooms_select_private on every INSERT, completing the recursion.
--
-- Diagnosis (2026-06-15 review of live prod errors):
--   INSERT chat_room_members → policy WITH CHECK reads chat_rooms.group_type
--     → triggers chat_rooms_select_private (002, line 152)
--     → that subqueries chat_room_members WHERE user_id = auth.uid()
--     → that triggers chat_room_members_select (015)
--     → which self-references chat_room_members in an OR branch
--     → Postgres detects the loop and aborts with 42P17
--
-- The fix: SECURITY DEFINER STABLE helper functions that bypass RLS for the
-- membership / owner / visibility / group_type lookups, then rewrite every
-- policy that previously inlined a chat_room_members or chat_rooms subquery
-- to call a helper instead. The helpers run as their owner (postgres) and
-- skip RLS entirely, so they can't re-enter the policy graph.
--
-- Same recursion family affected messages, match_moments — fixed here too
-- defensively. watch_party_rsvps was already loop-free.

CREATE OR REPLACE FUNCTION public.is_chat_room_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.chat_room_members WHERE chat_room_id = p_room_id AND user_id = p_user_id); $$;

CREATE OR REPLACE FUNCTION public.is_chat_room_owner(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.chat_rooms WHERE id = p_room_id AND owner_id = p_user_id); $$;

CREATE OR REPLACE FUNCTION public.chat_room_visibility(p_room_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT visibility FROM public.chat_rooms WHERE id = p_room_id; $$;

CREATE OR REPLACE FUNCTION public.chat_room_group_type(p_room_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT group_type FROM public.chat_rooms WHERE id = p_room_id; $$;

GRANT EXECUTE ON FUNCTION public.is_chat_room_member(UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_room_owner(UUID,UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_visibility(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_group_type(UUID)     TO authenticated;

DROP POLICY IF EXISTS chat_room_members_select  ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_insert  ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_update  ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_delete  ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_service ON chat_room_members;
DROP POLICY IF EXISTS chat_room_members_admin   ON chat_room_members;

CREATE POLICY chat_room_members_select ON chat_room_members
    FOR SELECT TO authenticated USING (
        user_id = auth.uid()
        OR public.is_chat_room_member(chat_room_id, auth.uid())
        OR public.is_chat_room_owner(chat_room_id, auth.uid())
        OR public.is_admin()
    );

CREATE POLICY chat_room_members_insert ON chat_room_members
    FOR INSERT TO authenticated WITH CHECK (
        (
            user_id = auth.uid()
            AND public.chat_room_visibility(chat_room_id) = 'public'
            AND public.has_premium_access(auth.uid())
            AND (
                public.chat_room_group_type(chat_room_id) IS DISTINCT FROM 'worldcup'
                OR public.has_wc_access(auth.uid())
            )
        )
        OR public.is_chat_room_owner(chat_room_id, auth.uid())
        OR public.is_admin()
    );

CREATE POLICY chat_room_members_update ON chat_room_members
    FOR UPDATE TO authenticated
    USING (public.is_chat_room_owner(chat_room_id, auth.uid()) OR public.is_admin())
    WITH CHECK (public.is_chat_room_owner(chat_room_id, auth.uid()) OR public.is_admin());

CREATE POLICY chat_room_members_delete ON chat_room_members
    FOR DELETE TO authenticated USING (
        user_id = auth.uid()
        OR public.is_chat_room_owner(chat_room_id, auth.uid())
        OR public.is_admin()
    );

CREATE POLICY chat_room_members_service ON chat_room_members
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS chat_rooms_select_private ON chat_rooms;
CREATE POLICY chat_rooms_select_private ON chat_rooms
    FOR SELECT TO authenticated USING (
        visibility = 'private' AND (
            owner_id = auth.uid()
            OR public.is_chat_room_member(id, auth.uid())
            OR public.is_admin()
        )
    );

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
    FOR SELECT TO authenticated USING (
        public.is_chat_room_member(chat_room_id, auth.uid())
        AND user_id NOT IN (SELECT public.blocked_user_ids())
    );

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
    FOR INSERT TO authenticated WITH CHECK (
        user_id = auth.uid()
        AND public.has_premium_access(auth.uid())
        AND public.is_chat_room_member(chat_room_id, auth.uid())
    );

DROP POLICY IF EXISTS match_moments_select ON match_moments;
CREATE POLICY match_moments_select ON match_moments
    FOR SELECT TO authenticated USING (public.is_chat_room_member(chat_room_id, auth.uid()));

NOTIFY pgrst, 'reload schema';
