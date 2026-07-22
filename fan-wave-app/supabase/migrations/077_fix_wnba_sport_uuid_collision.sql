-- 077: Fix WNBA sport UUID collision + backfill missing leagues (v9.1.7)
--
-- WHY:
--   v9.1 UAT 2026-07-22 diagnostic: Test #11 SQL probe revealed that the
--   sports row for UUID a0000000-0000-0000-0000-000000000009 is UFC, not
--   WNBA. UFC must have been seeded between mig 007 and mig 075 (via a
--   later migration or manual insert) and mig 075 didn't account for it.
--
--   Effect: mig 075's `INSERT INTO sports ... ON CONFLICT (id) DO NOTHING`
--   silently skipped WNBA sport insert. Then its `INSERT INTO leagues ...`
--   likely inserted the WNBA league row pointing at sport_id 000000009
--   (which is now UFC, not WNBA) -- so WNBA games would have been
--   classified as UFC.
--
--   Two-part fix in this migration:
--     1. Insert WNBA sport at a NEW unused UUID a0000000-...-00000000000a.
--     2. UPDATE any existing WNBA league row to point at that new WNBA
--        sport UUID (repairs mig 075's mis-linked row).
--     3. Belt-and-suspenders: INSERT the WNBA league row if it wasn't
--        created by mig 075 for any reason.
--     4. Also ensure College Football league exists (mig 069 required)
--        and College Basketball league exists (mig 075 required).
--
-- Idempotent -- safe to replay.

BEGIN;

-- ─── 1. WNBA sport at UUID 00000000000a (was 000000009, now taken by UFC) ─
INSERT INTO public.sports (id, name, icon, color) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'WNBA', '🏀', '#ff6b35')
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Fix any existing WNBA league row that mig 075 mis-linked to UFC ──
UPDATE public.leagues
   SET sport_id = 'a0000000-0000-0000-0000-00000000000a'
 WHERE name = 'WNBA'
   AND sport_id = 'a0000000-0000-0000-0000-000000000009';  -- UFC

-- ─── 3. Ensure WNBA league row exists ────────────────────────────────
-- If mig 075's INSERT was skipped entirely for reasons unknown, this
-- creates it. If it already exists (whether at the pre-fix wrong
-- sport_id or the post-UPDATE correct one), ON CONFLICT is a no-op.
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000009',
   'a0000000-0000-0000-0000-00000000000a',
   'WNBA', 'USA', '🏀')
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Ensure College Football league exists (mig 069 dep) ──────────
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-000000000008',
   'a0000000-0000-0000-0000-000000000007',
   'College Football', 'USA', '🏈')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Ensure College Basketball league exists (mig 075 dep) ────────
INSERT INTO public.leagues (id, sport_id, name, country, icon) VALUES
  ('b0000000-0000-0000-0000-00000000000a',
   'a0000000-0000-0000-0000-000000000008',
   'College Basketball', 'USA', '🏀')
ON CONFLICT (id) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify with:
--   SELECT id, name FROM public.sports WHERE name = 'WNBA';
--   -- expect: id = a0000000-0000-0000-0000-00000000000a
--
--   SELECT l.id, l.name, s.name AS sport
--     FROM public.leagues l
--     JOIN public.sports  s ON s.id = l.sport_id
--    WHERE l.name IN ('WNBA', 'College Football', 'College Basketball');
--   -- expect: 3 rows, all with sport matching league name
