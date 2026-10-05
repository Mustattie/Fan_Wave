-- 108: member_count triggers must bypass chat_rooms RLS and count atomically;
--      reconcile the drift. One transaction, bounded lock wait.
--
-- WHY (prod, 2026-10-03, Build 33/34 UAT):
--   "Anaheim Ducks Fans" (cf06ddf9) stored member_count = 1 while
--   chat_room_members holds 3 rows. Across all rooms: 12 of 62 drifted,
--   138 membership rows vs 115 counted. Every drifted room's missing
--   members are NON-OWNERS who joined after migration 094's backfill
--   (joins on 2026-09-16 and 2026-10-03).
--
--   increment_member_count() / decrement_member_count() (002, rewritten in
--   008) are plain SECURITY INVOKER functions. chat_rooms has RLS with
--   chat_rooms_update USING/WITH CHECK (owner_id = auth.uid()). The AFTER
--   INSERT trigger therefore runs its UPDATE as the joining user; for a
--   non-owner the policy matches zero rows and the UPDATE succeeds with
--   0 rows affected -- no error, no count. Only the owner's own join (or a
--   service-role insert, e.g. the seeds) ever moved the counter, which is
--   why 094 could believe "the triggers keep it honest".
--
--   User-visible: the group header and Discover cards read "1 member" with
--   three members, Discover orders public groups by member_count DESC so
--   joined groups sink, and the v9.5.43 client refetch faithfully shows the
--   wrong server value. The owner's phone showed "2 members" only because
--   handleJoin bumps its local copy.
--
-- FIX:
--   1. Re-create both trigger functions as SECURITY DEFINER (owner:
--      postgres, which bypasses RLS) with a pinned search_path. They touch
--      exactly one row, chosen by NEW/OLD.chat_room_id -- no user-controlled
--      SQL, no broadening.
--   2. Count ATOMICALLY (member_count + 1 / - 1) instead of recounting.
--      008's recount runs under the statement snapshot: two concurrent
--      joins serialise on the room row, but the second one's COUNT(*) was
--      taken before the first committed, so it writes n+1 where n+2 is
--      true. An atomic delta is evaluated against the row version the
--      UPDATE actually locks, so concurrent joins/leaves cannot drift.
--      GREATEST(…, 0) keeps a delete on an already-zero room sane.
--   3. Reconcile every room from the membership rows (094's statement) in
--      the SAME transaction, after the functions switch, so the deltas start
--      from a correct base. Idempotent: a second run reconciles nothing.
--
-- APPLY: the whole file is one transaction (BEGIN … COMMIT). DROP TRIGGER
-- takes ACCESS EXCLUSIVE on chat_room_members for the rest of the
-- transaction; lock_timeout bounds the wait so an apply under load fails
-- cleanly (re-run it) instead of queueing writers behind it. Apply through
-- the Management API query endpoint; never `db push` (ledger stale at 063).
--
-- SAFETY: no schema change, no RLS change. EXECUTE on the two functions is
-- revoked from app roles; triggers do not need it (the privilege check is at
-- CREATE TRIGGER time, which runs as postgres). Reversal block at the footer
-- (restores SECURITY INVOKER; the reconciled counts are correct and stay).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.increment_member_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.chat_rooms
       SET member_count = member_count + 1
     WHERE id = NEW.chat_room_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_member_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.chat_rooms
       SET member_count = GREATEST(member_count - 1, 0)
     WHERE id = OLD.chat_room_id;
    RETURN OLD;
END;
$$;

ALTER FUNCTION public.increment_member_count() OWNER TO postgres;
ALTER FUNCTION public.decrement_member_count() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.increment_member_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_member_count() FROM PUBLIC, anon, authenticated;

-- The triggers themselves are unchanged (002: trg_chat_room_member_insert /
-- trg_chat_room_member_delete). Re-assert them so a database where they
-- were dropped by hand is repaired too. Inside this transaction there is no
-- trigger-less window visible to other sessions.
DROP TRIGGER IF EXISTS trg_chat_room_member_insert ON public.chat_room_members;
CREATE TRIGGER trg_chat_room_member_insert
    AFTER INSERT ON public.chat_room_members
    FOR EACH ROW EXECUTE FUNCTION public.increment_member_count();
DROP TRIGGER IF EXISTS trg_chat_room_member_delete ON public.chat_room_members;
CREATE TRIGGER trg_chat_room_member_delete
    AFTER DELETE ON public.chat_room_members
    FOR EACH ROW EXECUTE FUNCTION public.decrement_member_count();

-- Reconcile (094's statement, repeated): membership rows are the truth.
-- Runs after the trigger switch, inside the same transaction, so every
-- later delta starts from a correct base.
DO $$
DECLARE
  v_fixed INT;
BEGIN
  UPDATE public.chat_rooms r
  SET member_count = actual.n
  FROM (
    SELECT r2.id, (SELECT count(*) FROM public.chat_room_members m WHERE m.chat_room_id = r2.id) AS n
    FROM public.chat_rooms r2
  ) actual
  WHERE actual.id = r.id
    AND r.member_count IS DISTINCT FROM actual.n;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE '108: reconciled member_count on % room(s)', v_fixed;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only, run after apply):
--   SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('increment_member_count','decrement_member_count');
--   -- both prosecdef = true, proconfig = {search_path=public, pg_temp}
--   SELECT count(*) FILTER (WHERE r.member_count <> a.n) AS drifted
--     FROM public.chat_rooms r
--     JOIN LATERAL (SELECT count(*) n FROM public.chat_room_members m WHERE m.chat_room_id = r.id) a ON true;
--   -- drifted = 0
--
-- REVERSAL-BEGIN (executable; leaves the reconciled counts in place)
--   ALTER FUNCTION public.increment_member_count() SECURITY INVOKER;
--   ALTER FUNCTION public.decrement_member_count() SECURITY INVOKER;
--   GRANT EXECUTE ON FUNCTION public.increment_member_count() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.decrement_member_count() TO PUBLIC;
-- REVERSAL-END
-- ---------------------------------------------------------------------------
