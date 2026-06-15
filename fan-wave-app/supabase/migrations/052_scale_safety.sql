-- 052: scale safety pass for the live-tournament window
--
-- The DB-architect audit (2026-06-15) flagged five gaps that would surface
-- under 100+ concurrent users during a live match:
--
-- G1 — supabase_realtime publication is missing every hot social table.
--      `messages`, `media_clips`, `watch_party_rsvps`, `match_moments` were
--      never published, so postgres_changes subscriptions in the client
--      silently no-op. This is the root cause of "chat feels stuck" and
--      "clip feed doesn't update during a goal burst" reports.
--
-- G2 — REPLICA IDENTITY DEFAULT only carries the primary key on
--      DELETE/UPDATE payloads. For Realtime to surface row contents in
--      those events (we use them for live RSVP-count updates), we set
--      REPLICA IDENTITY FULL.
--
-- G4 — match_moments_insert still has an inline `SELECT ... FROM chat_rooms`
--      scalar subquery. 051 switched everything else to the SECURITY
--      DEFINER STABLE helper pattern; doing the same here for consistency
--      and to remove the last surface area for future recursion regressions.
--
-- G5 — rate_limits has a probabilistic 1% GC inside the function. At 100
--      users * dozens of actions/min, rows pile up between sweeps. A
--      deterministic pg_cron schedule cleans the table every 2 minutes.

-- ─── G1 + G2: publish hot tables ─────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.media_clips;
ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_party_rsvps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_moments;

ALTER TABLE public.messages          REPLICA IDENTITY FULL;
ALTER TABLE public.media_clips       REPLICA IDENTITY FULL;
ALTER TABLE public.watch_party_rsvps REPLICA IDENTITY FULL;
ALTER TABLE public.match_moments     REPLICA IDENTITY FULL;

-- ─── G5: deterministic rate_limits GC ───────────────────────
SELECT cron.schedule(
  'gc-rate-limits',
  '*/2 * * * *',
  $$DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '5 minutes'$$
);

-- ─── G4: consistent helper use in match_moments_insert ──────
DROP POLICY IF EXISTS match_moments_insert ON public.match_moments;
CREATE POLICY match_moments_insert ON public.match_moments
  FOR INSERT TO authenticated WITH CHECK (
      user_id = auth.uid()
      AND public.has_premium_access(auth.uid())
      AND (
        public.chat_room_group_type(chat_room_id) IS DISTINCT FROM 'worldcup'
        OR public.has_wc_access(auth.uid())
      )
      AND public.is_chat_room_member(chat_room_id, auth.uid())
  );

-- ─── Freshen stats on RLS-helper-targeted tables ────────────
ANALYZE public.chat_room_members;
ANALYZE public.chat_rooms;
ANALYZE public.messages;
ANALYZE public.media_clips;

NOTIFY pgrst, 'reload schema';
