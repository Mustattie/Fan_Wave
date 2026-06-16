-- 054: Free chat moments (highlights) for group members.
--
-- WHY:
--   The product design pivoted to "paywall fires at signup, never mid-app."
--   match_moments_insert (migration 033) still requires has_premium_access()
--   even for members of a group they joined, which surfaces a subscription
--   popup every time a free user (or reviewer) taps "Post a Moment". Same
--   freemium funnel issue we just fixed for chat messages in 053.
--
--   Posting moments / highlights inside a group you're already a member of
--   is exactly the engagement loop we want, so it should be free. The DB
--   still enforces:
--     • caller must be the row's user_id (no impersonation)
--     • caller must actually be a member of the chat_room
--     • WC groups still require has_wc_access() (preserves the pass gate)
--
-- WHAT this migration does NOT change:
--   • media_clips_insert  (still Premium — the standalone Clips feed is
--                          the marquee premium feature)
--   • watch_parties_insert (still Premium — creating an event is premium)
--   • chat_rooms_insert    (still Premium OR first-group-free quota)

DROP POLICY IF EXISTS match_moments_insert ON public.match_moments;
CREATE POLICY match_moments_insert ON public.match_moments
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND public.is_chat_room_member(chat_room_id, auth.uid())
    AND (
      public.chat_room_group_type(chat_room_id) IS DISTINCT FROM 'worldcup'
      OR public.has_wc_access(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
