-- 061_backfill_chat_room_owner_members.sql
-- v8.5 P0: backfill chat_room_members rows for chat_rooms that were
-- created before the create-wc-group.tsx owner-as-member fix. Those
-- groups have owner_id set but NO matching chat_room_members row, so the
-- owner gets the v8.4 UAT "you may need to join this group before
-- posting" alert when they try to post a moment in their OWN group.
--
-- IMPORTANT: scope to REAL owners (auth.users.id != all-zeros system
-- uuid). The phase-2 probe revealed ~200 seeded sport/world-cup groups
-- whose owner_id is the system-seed UUID (00000000-...-000000000000).
-- Those don't need chat_room_members rows — no real user posts in
-- them as "the owner."
--
-- Pre-migration prod evidence (2026-06-19):
--   Real-user-owned orphans: 2 (worldcup groups "USA", "DALLAS SOCCER FANS",
--   both owned by 1fb5477d-...-4e1f6eecc874 = fansphere.reviewer)
--
-- ON CONFLICT DO NOTHING makes this idempotent.

INSERT INTO public.chat_room_members (chat_room_id, user_id, role)
SELECT cr.id, cr.owner_id, 'owner'
FROM public.chat_rooms cr
WHERE cr.owner_id IS NOT NULL
  AND cr.owner_id <> '00000000-0000-0000-0000-000000000000'::uuid
  AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = cr.owner_id)
  AND NOT EXISTS (
    SELECT 1
    FROM public.chat_room_members m
    WHERE m.chat_room_id = cr.id
      AND m.user_id = cr.owner_id
  )
ON CONFLICT (chat_room_id, user_id) DO NOTHING;
