-- 101: operational kill-switch rows (P3.3, 2026-09-25)
--
-- STATUS: PREPARED, NOT APPLIED. Apply via the Management API query
-- endpoint after owner approval (see docs/runbooks.md and the memory note
-- "Prod Migration Apply Path"). Safe to apply at any time: the client
-- (lib/killSwitches.ts) treats a missing row as "enabled", so these rows
-- only make the switches visible in Studio -- nothing changes until an
-- operator sets enabled = false.
--
-- Table: public.feature_flags (001_base_schema.sql:71-78). RLS: public
-- read, service_role write. No policy change is needed.
--
-- To pause a feature in an emergency (Studio SQL editor, runs as postgres):
--   UPDATE public.feature_flags SET enabled = false WHERE key = 'chat_send';
-- Active devices pick the change up within 5 minutes or on the next
-- return to the foreground. To resume: SET enabled = true.
--
-- Reversible: DELETE FROM public.feature_flags WHERE key IN (...) -- the
-- client falls back to enabled.

INSERT INTO public.feature_flags (key, enabled, config)
VALUES
  ('clips_upload',   true, '{"purpose": "kill switch: pause new clip uploads (jobs are kept with Retry)"}'::jsonb),
  ('chat_send',      true, '{"purpose": "kill switch: pause chat text/media sends"}'::jsonb),
  ('games_realtime', true, '{"purpose": "kill switch: stop joining the games-realtime channel (REST reads continue)"}'::jsonb),
  ('presence',       true, '{"purpose": "kill switch: stop presence tracking in chat rooms"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
