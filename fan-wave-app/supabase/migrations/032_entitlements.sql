-- 032: entitlements schema for Premium subscription + one-time WC Pass.
-- Source of truth: written ONLY by the RevenueCat webhook (service_role).
-- A denormalized snapshot lives on public.users so RLS can do entitlement
-- checks without a JOIN.
--
-- has_premium_access(uid) and has_wc_access(uid) are the helpers other
-- policies (FW-86) will inline. Both accept an auth.users.id (matches
-- auth.uid() and the convention used throughout the codebase where
-- public.users.auth_id references auth.users.id).

-- ─── 1. Denormalized snapshot on users ──────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none', 'trial', 'active', 'cancelled', 'expired')),
  ADD COLUMN IF NOT EXISTS premium_active_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wc_pass_active_until TIMESTAMPTZ;

-- NavigationGuard hits this on every app open
CREATE INDEX IF NOT EXISTS users_subscription_status_idx ON users (subscription_status);

-- ─── 2. Entitlements ledger ─────────────────────────────────────────
-- One row per purchase, holds the current state. original_transaction_id
-- is the dedup key (Apple/Google issue one ID per subscription lifecycle,
-- stable across renewals).
CREATE TABLE IF NOT EXISTS entitlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  product_id               TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'cancelled', 'expired', 'refunded', 'billing_issue')),
  original_transaction_id  TEXT UNIQUE NOT NULL,
  expires_at               TIMESTAMPTZ,
  raw_payload              JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx    ON entitlements (user_id);
CREATE INDEX IF NOT EXISTS entitlements_expires_at_idx ON entitlements (expires_at);

-- ─── 3. Purchase events ledger (webhook idempotency) ────────────────
-- Every webhook landed here first. UNIQUE on event_id is the idempotency
-- guard — a re-delivered event short-circuits with a no-op insert.
CREATE TABLE IF NOT EXISTS purchase_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT UNIQUE NOT NULL,
  user_id     UUID,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_events_user_id_idx   ON purchase_events (user_id);
CREATE INDEX IF NOT EXISTS purchase_events_processed_idx ON purchase_events (processed) WHERE processed = false;

-- ─── 4. RLS ──────────────────────────────────────────────────────────
ALTER TABLE entitlements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_events ENABLE ROW LEVEL SECURITY;

-- Users SELECT their own entitlements (Settings → Subscription screen reads here)
CREATE POLICY "Users read own entitlements" ON entitlements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- All writes restricted to service_role (only the webhook should touch this)
CREATE POLICY "Service insert entitlements" ON entitlements
  FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update entitlements" ON entitlements
  FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service delete entitlements" ON entitlements
  FOR DELETE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- purchase_events: not readable to end users at all — internal audit table
CREATE POLICY "Service select purchase_events" ON purchase_events
  FOR SELECT USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service insert purchase_events" ON purchase_events
  FOR INSERT WITH CHECK (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');
CREATE POLICY "Service update purchase_events" ON purchase_events
  FOR UPDATE USING (current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- ─── 5. Access check helpers ─────────────────────────────────────────
-- Called inline by other tables' RLS policies (FW-86). STABLE so PG can
-- cache the result per row in a single statement. SECURITY DEFINER so
-- the policy can read users.subscription_status without granting that
-- column SELECT to the caller's role.
--
-- Fail-closed semantics: if premium_active_until is NULL, access is
-- denied even if subscription_status looks active. Prevents an
-- inconsistent webhook write from leaking access.

CREATE OR REPLACE FUNCTION public.has_premium_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = uid
      AND u.subscription_status IN ('trial', 'active')
      AND u.premium_active_until IS NOT NULL
      AND u.premium_active_until > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.has_wc_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = uid
      AND (
        -- During the active trial, the WC tab is included as a teaser
        (u.subscription_status = 'trial'
          AND u.premium_active_until IS NOT NULL
          AND u.premium_active_until > now())
        -- Or after trial, an explicit WC Pass purchase
        OR (u.wc_pass_active_until IS NOT NULL AND u.wc_pass_active_until > now())
      )
  );
$$;

-- Allow client-side reads (useHasPremium, useHasWCAccess hooks call rpc())
GRANT EXECUTE ON FUNCTION public.has_premium_access(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_wc_access(UUID) TO authenticated, anon;

-- ─── 6. Inspection / verification ────────────────────────────────────
-- After apply, run:
--   SELECT public.has_premium_access('00000000-0000-0000-0000-000000000000'::uuid);
--   -- expect false (no such user)
--
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name IN ('subscription_status', 'premium_active_until', 'wc_pass_active_until');
--   -- expect 3 rows
