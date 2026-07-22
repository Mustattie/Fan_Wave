-- 076: Sweep leftover WC seed groups + watch parties (v9.1.5)
--
-- WHY:
--   v9.1 UAT 2026-07-22: founder saw stale WC content polluting Discover
--   even after v9.0/v9.1 sunset the WC product.
--     1. "United States Sup..." and 4 other WC groups on Suggested rail
--        despite the client filter (.neq group_type worldcup). Query 3
--        confirmed all 5 have group_type='worldcup' -- the client filter
--        should hide them but they still leak (cache / realtime path).
--     2. 23 of 24 watch_parties in the DB are past-dated (mig 006/047-era
--        WC seed data). Discover already hides these client-side with
--        .gt('starts_at', now()-2h), but they clutter admin views and one
--        surviving future-dated seed row ("France vs England Watch Party"
--        for Jul 25 2026) confused UAT because France vs England was
--        already played on 2026-07-18 in the seed's own match timeline.
--
--   WC is fully sunset per project_v9_pivot.md. Mig 060 already deleted
--   the fake game rows; this migration completes the sweep by removing
--   the group rows + watch party rows so the client-side filters become
--   defense-in-depth instead of the last line of defense.
--
--   Preserves: leagues + events + teams rows tied to WC 2026. Historic
--   FK integrity stays intact so anyone reading old rows still resolves
--   team names / event names cleanly.
--
-- WHAT (idempotent):
--   1. DELETE all chat_room_members whose chat_room is group_type='worldcup'.
--   2. DELETE all match_moments whose chat_room is group_type='worldcup'.
--   3. DELETE all messages whose chat_room is group_type='worldcup'.
--   4. DELETE the chat_rooms themselves.
--   5. DELETE all watch_party_rsvps for WC-event watch parties.
--   6. DELETE all watch_parties linked to the WC 2026 event.
--   7. (Preview only) SELECT surviving WC-title-pattern orphan parties
--      for manual review.

BEGIN;

-- ─── 1. chat_room_members for WC groups ────────────────────────────
DELETE FROM public.chat_room_members
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 2. match_moments in WC group chat rooms ──────────────────────
DELETE FROM public.match_moments
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 3. messages in WC group chat rooms ────────────────────────────
DELETE FROM public.messages
 WHERE chat_room_id IN (
   SELECT id FROM public.chat_rooms WHERE group_type = 'worldcup'
 );

-- ─── 4. the WC chat_rooms themselves ───────────────────────────────
DELETE FROM public.chat_rooms
 WHERE group_type = 'worldcup';

-- ─── 5. watch_party_rsvps for WC-event parties ─────────────────────
DELETE FROM public.watch_party_rsvps
 WHERE watch_party_id IN (
   SELECT id FROM public.watch_parties
    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid
 );

-- ─── 6. WC-event watch parties ─────────────────────────────────────
DELETE FROM public.watch_parties
 WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;

COMMIT;

-- ─── 7. Preview: orphan WC-titled parties (event_id IS NULL) ──────
-- These weren't linked to the WC event but have team-vs-team names
-- matching WC nations. Run manually AFTER the migration commits and
-- review; if you want them gone too, DELETE by id from the result set.
-- Left as a preview rather than an automated DELETE because "team vs
-- team" naming is legit for MLS / friendlies too and we don't want to
-- nuke user-created future parties.
--
-- SELECT id, title, starts_at, creator_id, created_at
--   FROM public.watch_parties
--  WHERE event_id IS NULL
--    AND title ~* '(france|england|argentina|brazil|germany|spain|portugal|italy|netherlands|belgium|croatia|morocco|senegal|japan|korea|mexico|usa|canada|united states|wales|iran|australia|denmark|switzerland|serbia|poland|uruguay|ecuador|ghana|cameroon|tunisia|qatar|saudi|ivory coast)\s+(vs?\.?\s+|-\s*|and\s+)'
--  ORDER BY starts_at DESC;

-- Verify with:
--   -- Should return 0
--   SELECT COUNT(*) AS wc_groups FROM public.chat_rooms WHERE group_type = 'worldcup';
--   -- Should return 0
--   SELECT COUNT(*) AS wc_event_parties FROM public.watch_parties
--    WHERE event_id = 'e0000000-0000-0000-0000-000000002026'::uuid;
--   -- Should return the same total as before minus WC-event parties
--   SELECT COUNT(*) AS total_parties FROM public.watch_parties;
