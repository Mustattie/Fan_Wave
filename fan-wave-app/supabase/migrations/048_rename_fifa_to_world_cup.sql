-- 048: rebrand FIFA / "World Cup" naming → "Soccer Cup" / "Soccer Cup 2026"
--
-- Apple Review rejected build 1.0.0 (8) on 2026-06-11 under Guideline 5.2.1
-- (Legal — Intellectual Property), citing "content that resembles FIFA
-- without the necessary authorization. Specifically, World Cup in your
-- metadata." Both "FIFA" and the bare phrase "World Cup" were treated as
-- infringing on FIFA's marks without authorization. We do not have a FIFA
-- license, so we rebrand the feature to a generic name that does not evoke
-- FIFA's tournaments.
--
-- This migration replaces the two seed-row names from migration 006. WHERE
-- clauses are name-guarded so re-running on a database already on the new
-- naming is a no-op (idempotent). Migration 006 itself is left untouched —
-- its old FIFA strings serve as the historical baseline; replaying 006 then
-- 048 on a clean DB produces the correct rebranded end state.

UPDATE public.leagues
   SET name = 'Soccer Cup'
 WHERE id = 'b0000000-0000-0000-0000-000000000026'
   AND name IN ('FIFA World Cup', 'World Cup');

UPDATE public.events
   SET name = 'Soccer Cup 2026'
 WHERE id = 'e0000000-0000-0000-0000-000000002026'
   AND name IN ('FIFA World Cup 2026', 'World Cup 2026');

-- Verify (run separately after apply):
--   SELECT id, name FROM leagues WHERE id = 'b0000000-0000-0000-0000-000000000026';
--   SELECT id, name FROM events  WHERE id = 'e0000000-0000-0000-0000-000000002026';
--   -- Expect: 'Soccer Cup' and 'Soccer Cup 2026'
