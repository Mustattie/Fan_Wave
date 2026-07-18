-- 071: Sunset World Cup RLS gates (v9.1 UAT correction)
--
-- WHY:
--   v9.1 UAT 2026-07-18: user tapped Join on a Suggested fan group and
--   hit "Could not join. Please try again." Root cause: the Suggested
--   list surfaced worldcup-typed groups (French national team etc. from
--   mig 006/064 seed), and mig 053's chat_room_members_insert policy
--   still requires has_wc_access(auth.uid()) for group_type='worldcup'.
--   Free-tier user without a WC Pass hits 42501.
--
--   Per project_v9_pivot.md, WC is being fully wound down as a distinct
--   product. Mig 070 already opened creation flows; this migration
--   removes the remaining WC branches from the FREE-TIER access paths
--   (join public group, RSVP watch party, follow team). The result: WC
--   content becomes ordinary soccer content, gated only by the same
--   rules as any other soccer group / league.
--
--   NB: mig 065 grandfathered WC Pass holders into +90d Premium, so
--   there's no user-facing regression — nobody who paid loses value.
--
-- WHAT this changes (idempotent):
--   1. chat_room_members_insert  — drop the worldcup branch, keep the
--                                  public-visibility check.
--   2. watch_party_rsvps_insert  — drop the WC event UUID branch.
--   3. user_team_follows insert  — drop the WC league UUID branch.
--
-- Reviewer bypass (mig 053) preserved for defense-in-depth. WC UI is
-- separately filtered on the client (v9.0 tab removal, v9.1 Discover
-- Suggested filter added same slice as this migration).

DROP POLICY IF EXISTS chat_room_members_insert ON public.chat_room_members;
CREATE POLICY chat_room_members_insert ON public.chat_room_members
  FOR INSERT TO authenticated WITH CHECK (
    (
      user_id = auth.uid()
      AND public.chat_room_visibility(chat_room_id) = 'public'
    )
    OR public.is_chat_room_owner(chat_room_id, auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS watch_party_rsvps_insert ON public.watch_party_rsvps;
CREATE POLICY watch_party_rsvps_insert ON public.watch_party_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own follows" ON public.user_team_follows;
CREATE POLICY "Users can insert own follows" ON public.user_team_follows
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- Verify with (as a free user with subscription_status='none'):
--   SET LOCAL role authenticated;
--   SET LOCAL request.jwt.claims TO '{"sub":"<free-user-auth-uid>"}';
--   -- WC group: France Fans (name pattern from mig 006 seed)
--   INSERT INTO public.chat_room_members(chat_room_id, user_id, role)
--     SELECT id, '<free-user-auth-uid>'::UUID, 'member'
--       FROM public.chat_rooms WHERE group_type = 'worldcup' LIMIT 1;
--   -- expect: 1 row inserted (previously 42501)
