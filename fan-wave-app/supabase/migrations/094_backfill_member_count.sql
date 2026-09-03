-- 094: member_count disagrees with reality on 51 of 57 groups.
--
-- WHY:
--   Found while purging seed groups (093). The stored counter is wrong almost
--   everywhere:
--
--     51 of 57 groups disagree with their actual chat_room_members rows
--     31 of those say 0 members while having real members
--     worst case "Dallas Legends": stored 1, actual 6
--
--   This is not cosmetic. Discover orders public groups by member_count DESC,
--   so the groups people have actually joined sort to the BOTTOM, beneath
--   emptier ones. The community looks deader than it is, which is the exact
--   problem 093 set out to fix.
--
--   It also nearly caused real damage: migration 093's delete criteria
--   included both `member_count = 0` AND `NOT EXISTS (chat_room_members)`.
--   Had it trusted the counter alone, it would have deleted 31 groups that
--   have members. Belt and braces earned its keep.
--
-- WHY IT DRIFTED, AND WHY A BACKFILL IS ENOUGH:
--   The maintenance triggers exist and are attached --
--   trg_chat_room_member_insert -> increment_member_count and
--   trg_chat_room_member_delete -> decrement_member_count. The damage is
--   historical: the 2026-06-09 seed inserted rooms and memberships around
--   those triggers, so the counter never saw the writes. Going forward the
--   triggers keep it honest, so this is a one-time reconciliation rather than
--   a new mechanism.
--
-- SAFETY: recomputes from the membership rows, which are the source of truth.
-- Idempotent -- a second run updates nothing.

DO $$
DECLARE
  v_fixed INT;
BEGIN
  UPDATE public.chat_rooms r
  SET member_count = actual.n
  FROM (
    SELECT r2.id, (SELECT count(*) FROM public.chat_room_members m WHERE m.chat_room_id = r2.id) AS n
    FROM public.chat_rooms r2
  ) AS actual
  WHERE r.id = actual.id
    AND COALESCE(r.member_count, 0) <> actual.n;

  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'reconciled member_count on % group(s)', v_fixed;
END;
$$;

-- ─── Verification ──────────────────────────────────────────────────
--
--   SELECT count(*) FROM public.chat_rooms r
--   WHERE COALESCE(r.member_count,0) <>
--         (SELECT count(*) FROM public.chat_room_members m WHERE m.chat_room_id = r.id);
--   -- expect: 0
--
--   -- And Discover's ordering now reflects reality:
--   SELECT name, member_count FROM public.chat_rooms
--   WHERE visibility='public' AND group_type='sports'
--   ORDER BY member_count DESC LIMIT 5;
