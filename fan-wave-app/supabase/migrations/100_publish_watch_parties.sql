-- 100: add watch_parties to the Realtime publication.
--
-- UAT 2026-09-22. The first Sentry `realtime.channel_error` after Phase 1
-- gave every channel a status callback pointed at the Home tab's
-- `watch-parties-<city>` subscription. It had never joined: watch_parties
-- was never published (034 added users, 043 games, 052 messages /
-- media_clips / watch_party_rsvps / match_moments -- nothing added this
-- table), and the client filter used `ilike`, which Realtime rejects.
-- Both halves are needed; the client half is in lib/realtime.ts.
--
-- Same guard as 034 / 043 so this replays safely. No REPLICA IDENTITY
-- change: the consumers use NEW only. RLS on watch_parties (mig 026 /
-- 053) is evaluated per subscriber by Realtime as usual; party inserts
-- are rare, so the cost is negligible.
--
-- Non-destructive: touches no table, row, function or policy.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'watch_parties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_parties;
  END IF;
END $$;

-- ─── Verification ────────────────────────────────────────────────────
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' ORDER BY 1;
--   -- expect watch_parties in the list
