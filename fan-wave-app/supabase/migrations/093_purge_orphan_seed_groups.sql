-- 093: delete the 2026-06-09 seed fan groups nobody ever touched.
--
-- WHY:
--   Discover ranks fan groups by member_count DESC, and prod holds 180 groups
--   of which 179 have one member or none. A new user's first impression of the
--   community is therefore a wall of empty groups -- and with the NFL opener
--   on 2026-09-10 that is the first impression that matters.
--
--   Where they came from: 154 were created in a single run on 2026-06-09, one
--   per team ("Buffalo Bills Fans", "Boston Celtics Fans", ...), owned by a
--   UUID with no matching row in auth.users. That orphan owner is the reliable
--   seed signal -- a real group always has a real owner.
--
-- WHAT IS DELETED — all five conditions, not any:
--   * group_type = 'sports'          (never a game_chat room)
--   * created 2026-06-09             (the one seeding run)
--   * owner has no auth.users row    (orphan)
--   * member_count = 0
--   * no chat_room_members row       (belt and braces: the counter can lie)
--   * no messages
--
--   That is 123 rows. Verified zero of them appear in ANY table with a foreign
--   key to chat_rooms: chat_room_members, messages, media_clips,
--   match_moments, banned_members. Nothing cascades because there is nothing
--   to cascade.
--
-- WHAT SURVIVES (57):
--   * 11 groups owned by real accounts
--   * 31 seeded groups somebody actually joined or posted in -- these were
--     seeded too, but a real person engaged with them, so they are real now
--   * 15 game_chat rooms, which this migration deliberately does not touch
--
-- NOT DELETED, deliberately: the seeded groups that DID get a member or a
-- message. Being seeded is not the disqualifier; being untouched is.
--
-- Re-running deletes zero rows.

DO $$
DECLARE
  v_deleted INT;
BEGIN
  WITH candidates AS (
    SELECT r.id
    FROM public.chat_rooms r
    WHERE r.group_type = 'sports'
      AND r.created_at::date = DATE '2026-06-09'
      AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = r.owner_id)
      AND COALESCE(r.member_count, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.chat_room_members m WHERE m.chat_room_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.messages g WHERE g.chat_room_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.media_clips c WHERE c.chat_room_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.match_moments mm WHERE mm.chat_room_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.banned_members b WHERE b.chat_room_id = r.id)
  )
  DELETE FROM public.chat_rooms r
  USING candidates c
  WHERE r.id = c.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'purged % orphaned seed group(s)', v_deleted;
END;
$$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   SELECT group_type, count(*) FROM public.chat_rooms GROUP BY 1;
--   -- expect: sports=42, game_chat=15
--
--   -- Nothing real was lost: every surviving sports group either has a real
--   -- owner or has been engaged with.
--   SELECT count(*) FROM public.chat_rooms r
--   WHERE r.group_type='sports'
--     AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id=r.owner_id)
--     AND COALESCE(r.member_count,0)=0;
--   -- expect: 0
