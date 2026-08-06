-- 082: Freemium tiered subscription model (v9.3 launch).
--
-- WHY:
--   v9.3 introduces a tiered freemium model to replace the flat $9.99
--   Premium subscription. See docs/payment-system.md and the v9.3 plan
--   file (i-have-a-key-quiet-tome.md) for the full rationale. Tiers:
--     free       — join everything, watch everything, 3 clips/day cap,
--                  1 lifetime fan group (existing soft gate), 1 public
--                  watch party per month (deferred to a later mig).
--     home_team  — $4.99/mo · $34.99/yr. Unlimited creation, private
--                  parties, Home Team badge, ad-free, priority search.
--     mvp        — $14.99/mo · $99.99/yr. All Home Team + advanced
--                  analytics + verified badge + featured placement.
--     business   — $99/mo · $999/yr (Stripe, web-signup only, Phase 3).
--
--   Existing $9.99 subscribers are grandfathered to 'mvp' at their
--   current price forever. This is a goodwill upgrade (they get MORE
--   features, pay the same) — zero revenue lost, brand-positive.
--
-- WHAT this migration does:
--   1. Adds public.users.subscription_tier column (enum-shaped CHECK).
--   2. Adds public.entitlements.tier column tagging each ledger row.
--   3. Adds has_tier_or_higher(uid, min_tier) helper with reviewer bypass.
--   4. Rewrites has_premium_access() to be a shim over
--      has_tier_or_higher(uid, 'home_team') so every existing RLS policy
--      and client caller keeps working with zero code changes at those
--      call sites.
--   5. Adds get_user_tier(uid) reviewer-aware accessor for client reads.
--   6. Extends enforce_entitlement_immutability() trigger (mig 040) to
--      also protect subscription_tier from user-side writes.
--   7. Backfills existing active/trial subscribers to 'mvp' tier.
--
-- SAFETY:
--   * Additive column with DEFAULT 'free' → no existing row breaks.
--   * has_premium_access() signature unchanged; behavior expanded only.
--   * has_tier_or_higher() uses SECURITY DEFINER STABLE with explicit
--     search_path — matches the pattern from migrations 032/051/053.
--   * Reviewer bypass returns tier='mvp' (highest end-user tier) so
--     Apple/Google reviewers can exercise every free-tier AND paid-tier
--     surface. Their subscription_status stays 'none' so the IAP funnel
--     is visible when they navigate to Subscription.
--   * Immutability trigger update is additive — extends the existing
--     check to include the new column; doesn't relax any protections.

-- ─── 1. users.subscription_tier ────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'home_team', 'mvp', 'business'));

CREATE INDEX IF NOT EXISTS users_subscription_tier_idx
  ON public.users (subscription_tier);

COMMENT ON COLUMN public.users.subscription_tier IS
  'Freemium tier: free | home_team | mvp | business. Written ONLY by the RevenueCat webhook (service_role) or admin. Protected by enforce_entitlement_immutability trigger.';

-- ─── 2. entitlements.tier ──────────────────────────────────────────
-- Per-purchase tier tag so the ledger tells us which SKU family a row
-- represents. Nullable during initial rollout so the webhook can start
-- writing it without breaking existing rows that predate this column.
ALTER TABLE public.entitlements
  ADD COLUMN IF NOT EXISTS tier TEXT
    CHECK (tier IN ('home_team', 'mvp', 'business') OR tier IS NULL);

-- ─── 3. Grandfather existing subscribers → 'mvp' ───────────────────
-- Users with an active or trialing premium subscription get upgraded
-- to MVP at their current price forever. This is the grandfathering
-- covenant from the v9.3 plan.
--
-- Trigger from mig 040 blocks this from client code but the migration
-- runs as postgres role, so the trigger's `current_user IN (...)` branch
-- permits it. Verified against mig 040 line ~41.
UPDATE public.users
SET subscription_tier = 'mvp'
WHERE subscription_status IN ('trial', 'active')
  AND premium_active_until IS NOT NULL
  AND premium_active_until > now()
  AND subscription_tier = 'free';

-- Tag existing entitlements rows with tier='mvp' as well so the ledger
-- is coherent post-migration. Only touches Premium products; the WC
-- pass ledger rows stay tier=NULL (WC pass is a one-time purchase, not
-- a tier).
UPDATE public.entitlements
SET tier = 'mvp'
WHERE product_id LIKE 'premium_%'
  AND tier IS NULL;

-- ─── 4. Tier rank helper ───────────────────────────────────────────
-- Numeric rank for ordering tiers. free=0 < home_team=1 < mvp=2 <
-- business=3. Business is the top tier because it grants venue/admin
-- scopes AND includes all consumer features for the account owner.
CREATE OR REPLACE FUNCTION public.tier_rank(t TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE t
    WHEN 'free'      THEN 0
    WHEN 'home_team' THEN 1
    WHEN 'mvp'       THEN 2
    WHEN 'business'  THEN 3
    ELSE 0
  END;
$$;

-- ─── 5. has_tier_or_higher(uid, min_tier) ──────────────────────────
-- The workhorse predicate for tiered gates. Reviewer bypass returns
-- TRUE for any min_tier so reviewers exercise every paid feature.
-- SECURITY DEFINER so RLS policies can call it without granting the
-- caller's role SELECT on users.subscription_tier.
CREATE OR REPLACE FUNCTION public.has_tier_or_higher(uid UUID, min_tier TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_reviewer_account(uid)
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = uid
          AND public.tier_rank(u.subscription_tier) >= public.tier_rank(min_tier)
      );
$$;

GRANT EXECUTE ON FUNCTION public.has_tier_or_higher(UUID, TEXT) TO authenticated, anon;

COMMENT ON FUNCTION public.has_tier_or_higher(UUID, TEXT) IS
  'Returns TRUE if the user is at min_tier or above. Reviewer accounts always return TRUE. Use in RLS policies for tier-gated features. See migration 082.';

-- ─── 6. get_user_tier(uid) ─────────────────────────────────────────
-- Client-facing accessor. Reviewers see 'mvp' (top end-user tier).
-- Non-existent users default to 'free' — fail-open at the tier level
-- is safe because feature-level checks all use has_tier_or_higher
-- which is fail-closed.
CREATE OR REPLACE FUNCTION public.get_user_tier(uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_reviewer_account(uid) THEN 'mvp'
    ELSE COALESCE(
      (SELECT u.subscription_tier FROM public.users u WHERE u.auth_id = uid),
      'free'
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_tier(UUID) TO authenticated, anon;

-- ─── 7. has_premium_access shim ────────────────────────────────────
-- Every existing RLS policy that references has_premium_access() keeps
-- working. The definition changes from "trial-or-active with a valid
-- premium_active_until" to "tier is home_team or higher OR reviewer OR
-- legacy premium row still active". This preserves grandfathered
-- entitlements even for users whose subscription_tier didn't backfill
-- (e.g. a user who signed up between migration apply time and their
-- next webhook event).
CREATE OR REPLACE FUNCTION public.has_premium_access(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_tier_or_higher(uid, 'home_team')
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = uid
          AND u.subscription_status IN ('trial', 'active')
          AND u.premium_active_until IS NOT NULL
          AND u.premium_active_until > now()
      );
$$;

-- ─── 8. Immutability trigger — protect subscription_tier ───────────
-- Extends enforce_entitlement_immutability() (mig 040) to also reject
-- direct subscription_tier writes from non-service roles. Same escape
-- hatches: service_role JWT (webhook), postgres / supabase_admin
-- direct connection.
CREATE OR REPLACE FUNCTION public.enforce_entitlement_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF NEW.subscription_status     IS NOT DISTINCT FROM OLD.subscription_status
     AND NEW.premium_active_until IS NOT DISTINCT FROM OLD.premium_active_until
     AND NEW.wc_pass_active_until IS NOT DISTINCT FROM OLD.wc_pass_active_until
     AND NEW.subscription_tier    IS NOT DISTINCT FROM OLD.subscription_tier THEN
    RETURN NEW;
  END IF;

  v_role := current_setting('request.jwt.claims', true)::json->>'role';
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Entitlement columns (subscription_status, premium_active_until, '
    'wc_pass_active_until, subscription_tier) are read-only for '
    'non-service roles. The RevenueCat webhook is the source of truth.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Trigger definition itself is unchanged (still BEFORE UPDATE on users)
-- but re-declare to be idempotent-safe.
DROP TRIGGER IF EXISTS users_entitlement_immutable ON public.users;
CREATE TRIGGER users_entitlement_immutable
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_entitlement_immutability();

NOTIFY pgrst, 'reload schema';

-- ─── Verification ──────────────────────────────────────────────────
--
--   -- Column present with 'free' default:
--   SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'subscription_tier';
--   -- expect: subscription_tier | 'free'::text
--
--   -- Grandfathering worked:
--   SELECT subscription_status, subscription_tier, count(*)
--   FROM public.users
--   GROUP BY 1,2 ORDER BY 1,2;
--   -- expect: rows where subscription_status IN ('trial','active') land
--   -- with subscription_tier='mvp'; everyone else stays 'free'.
--
--   -- Reviewer sees mvp:
--   SELECT public.get_user_tier(
--     (SELECT id FROM auth.users WHERE lower(email)='fansphere.reviewer@gmail.com')
--   );
--   -- expect: 'mvp'
--
--   -- Tier ordering:
--   SELECT public.has_tier_or_higher('<free-user-uid>'::uuid, 'home_team');
--   -- expect: false
--
--   -- has_premium_access shim still returns TRUE for grandfathered subs:
--   SELECT public.has_premium_access('<grandfathered-user-uid>'::uuid);
--   -- expect: true
--
--   -- Trigger rejects a direct client-side tier write (as authenticated):
--   SET LOCAL role authenticated;
--   UPDATE public.users SET subscription_tier='mvp' WHERE auth_id=auth.uid();
--   -- expect: ERROR: Entitlement columns ... are read-only (insufficient_privilege)
