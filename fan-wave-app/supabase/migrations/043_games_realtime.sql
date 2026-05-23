-- 043: add games table to the supabase_realtime publication so the client
-- can subscribe to UPDATE events and refresh the Today's Games carousel
-- the instant the sync writes a new score / status / period — no more 60s
-- staleTime gap or pull-to-refresh dependency. Mirrors the pattern from
-- migration 034 (users realtime for entitlements).
--
-- Subscription pattern (client side, lib/realtime.ts):
--   .channel('games-realtime')
--   .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' },
--       () => queryClient.invalidateQueries(['games']))
--
-- RLS note: games has "Public read games" FOR SELECT USING (true) from
-- migration 001 — anyone can subscribe, payloads always delivered.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
  END IF;
END $$;

-- Verify with:
--   SELECT pubname, tablename FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' AND tablename='games';
