-- 034: add users table to the supabase_realtime publication so the
-- RevenueCat webhook's UPDATE on subscription_status / premium_active_until
-- propagates to subscribed clients (FW-90 useEntitlementsRealtime hook).
-- Without this, entitlement changes only show up on the next manual refetch.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  END IF;
END $$;
