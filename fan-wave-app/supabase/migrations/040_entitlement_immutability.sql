-- 040: enforce entitlement column immutability for non-service roles.
--
-- Per migration 032's design intent, subscription_status / premium_active_until /
-- wc_pass_active_until are the source of truth for paywall gating and were
-- meant to be written ONLY by the RevenueCat webhook (service_role). But the
-- "Users update own profile" policy from migration 001 grants authenticated
-- users UPDATE on the whole row — they could self-grant premium with a
-- direct Supabase call. This is the exact bypass the temporary __DEV__
-- shortcut in lib/entitlements.ts exploited for render-walking.
--
-- Fix: BEFORE UPDATE trigger that rejects any change to the three
-- entitlement columns unless the caller is service_role (HTTP webhook/cron
-- with a service-role JWT) or a privileged DB role (direct connection via
-- supabase db push, psql, the dashboard SQL editor). RLS row-level
-- policies stay intact; this is a column-write check layered on top.

CREATE OR REPLACE FUNCTION public.enforce_entitlement_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Cheap early-out: if no entitlement column actually changed, allow.
  -- Profile UPDATEs (display_name, avatar_url, etc.) hit this trigger
  -- too; we don't want to pay the role lookup for every one of them.
  IF NEW.subscription_status     IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.premium_active_until IS NOT DISTINCT FROM OLD.premium_active_until
     AND NEW.wc_pass_active_until IS NOT DISTINCT FROM OLD.wc_pass_active_until THEN
    RETURN NEW;
  END IF;

  -- HTTP requests (webhook, cron via pg_net) carry the JWT role in
  -- request.jwt.claims. Direct DB connections (psql, migrations, SQL
  -- editor) don't, but they connect as postgres / supabase_admin.
  v_role := current_setting('request.jwt.claims', true)::json->>'role';
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Entitlement columns (subscription_status, premium_active_until, '
    'wc_pass_active_until) are read-only for non-service roles. The '
    'RevenueCat webhook is the source of truth.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS users_entitlement_immutable ON users;
CREATE TRIGGER users_entitlement_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_entitlement_immutability();

-- ─── Smoke tests ─────────────────────────────────────────────────────
--
-- Negative (as authenticated user via supabase-js — expect insufficient_privilege):
--   UPDATE users SET subscription_status='trial' WHERE auth_id = auth.uid();
--
-- Positive (as postgres/SQL editor — expect success). Use this snippet
-- to grant yourself a trial when render-walking the monetization flow:
--   UPDATE users
--   SET subscription_status='trial',
--       premium_active_until = now() + interval '7 days'
--   WHERE auth_id = (SELECT id FROM auth.users WHERE email='YOUR_EMAIL');
--
-- To revert / cancel for testing the Resubscribe flow:
--   UPDATE users
--   SET subscription_status='expired', premium_active_until=NULL, wc_pass_active_until=NULL
--   WHERE auth_id = (SELECT id FROM auth.users WHERE email='YOUR_EMAIL');
