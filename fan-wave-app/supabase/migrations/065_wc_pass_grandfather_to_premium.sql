-- 065: Grandfather active WC Pass holders into +90 days of Fan Sphere Premium.
--
-- WHY this migration exists:
--   v9.0 pivots away from the one-time World Cup Pass SKU as a first-class
--   monetization product. The WC feature set (WC groups, WC watch parties,
--   national-team follows) collapses under the Premium umbrella so we can
--   stop maintaining two orthogonal entitlement lanes. Anyone who paid for
--   a WC Pass ahead of the pivot has a live entitlement we contractually
--   owe — the fairest conversion is to give them Premium for a duration
--   that comfortably covers the tail of the WC tournament and beyond.
--
-- WHAT this migration does:
--   For every user with wc_pass_active_until > now(), extend their
--   premium_active_until to at least (now() + 90 days). If they already
--   have Premium active past that horizon (annual subscriber who also
--   bought a WC Pass, edge case), we preserve their longer window via
--   GREATEST — this migration never shortens an entitlement.
--
-- WHAT this migration does NOT change:
--   - wc_pass_active_until stays populated as legacy/audit data. The
--     column is not dropped; has_wc_access() in migration 053 still reads
--     it and reviewer bypass still works exactly as before.
--   - subscription_status is left alone. These users may be status='none'
--     (paid-only WC Pass) and we don't want to fabricate a fake 'active'
--     status that the RevenueCat webhook will overwrite. has_premium_access
--     also requires subscription_status IN ('trial','active') — see the
--     "SEMANTIC NOTE" below for how we resolve that.
--   - RLS policies from 032/033/040/053 are untouched.
--   - RevenueCat webhook path is untouched. Any live WC Pass renewals
--     (there shouldn't be any post-pivot, but the SKU may still flow
--     through RC replay) land in entitlements as before.
--
-- SEMANTIC NOTE (subscription_status):
--   has_premium_access() in mig 053 gates on subscription_status IN
--   ('trial','active') AND premium_active_until > now(). Purely bumping
--   premium_active_until without touching subscription_status therefore
--   would NOT actually unlock Premium at the DB layer. For the comp to
--   have effect we also flip subscription_status to 'active' when it is
--   currently 'none' or 'expired'. We deliberately do NOT downgrade
--   'trial' users (their trial signal matters for the reminder cron in
--   mig 035) and we do NOT overwrite 'cancelled' (that signals user
--   intent to end the sub; RC will settle the final state).
--
-- SAFETY / IDEMPOTENCY:
--   All state changes are logged to entitlement_migrations
--   (user_id, migration_key). Re-running this migration file is a no-op
--   for any user already recorded under key 'wc_pass_to_premium_90d'.
--   The tracking table lives outside the users row so RLS on it can be
--   managed independently in a future migration if we ever expose it.
--
--   This migration runs as the postgres role during `supabase db push`,
--   which bypasses RLS AND satisfies the current_user allow-list in the
--   enforce_entitlement_immutability trigger from mig 040. No policy
--   changes required.

-- ─── 1. Tracking table for per-user, per-comp idempotency ─────────────
-- One row per (user, migration_key). Future entitlement comps
-- (e.g. loyalty perks, apology credits) reuse this table with their
-- own migration_key. The primary key on user_id alone would prevent
-- that; instead we use a synthetic id and a unique constraint on the
-- pair. Kept minimal — no soft-delete, no metadata JSONB — because
-- everything we need is reconstructable from the migration file itself.

CREATE TABLE IF NOT EXISTS public.entitlement_migrations (
  user_id        UUID NOT NULL,
  migration_key  TEXT NOT NULL,
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, migration_key)
);

CREATE INDEX IF NOT EXISTS entitlement_migrations_key_idx
  ON public.entitlement_migrations (migration_key);

COMMENT ON TABLE public.entitlement_migrations IS
  'Audit + idempotency ledger for entitlement grandfather comps applied via DB migration (not RevenueCat). One row per (user_id, migration_key). See migration 065 for the first entry: wc_pass_to_premium_90d.';

-- ─── 2. Apply the comp inside a DO block for RAISE NOTICE metrics ─────

DO $$
DECLARE
  v_comped_count  INT := 0;
  v_skipped_count INT := 0;
  v_eligible_count INT := 0;
BEGIN
  -- Snapshot the population up-front so the counts are consistent even
  -- if concurrent RC webhooks land mid-migration. Total holders of a
  -- currently-valid WC Pass.
  SELECT COUNT(*) INTO v_eligible_count
    FROM public.users u
   WHERE u.wc_pass_active_until IS NOT NULL
     AND u.wc_pass_active_until > now();

  -- Perform the comp. RETURNING lets us count actual updates without
  -- a second scan. The NOT EXISTS clause is the idempotency guard.
  WITH targets AS (
    SELECT u.id
      FROM public.users u
     WHERE u.wc_pass_active_until IS NOT NULL
       AND u.wc_pass_active_until > now()
       AND NOT EXISTS (
         SELECT 1 FROM public.entitlement_migrations em
          WHERE em.user_id = u.id
            AND em.migration_key = 'wc_pass_to_premium_90d'
       )
  ),
  updated AS (
    UPDATE public.users u
       SET premium_active_until = GREATEST(
             COALESCE(u.premium_active_until, now()),
             now() + INTERVAL '90 days'
           ),
           subscription_status = CASE
             -- Preserve trial (mig 035 reminder cron depends on it) and
             -- cancelled (user-signalled intent to end). Everyone else
             -- becomes 'active' so has_premium_access() actually gates
             -- open. 'active' users stay 'active'.
             WHEN u.subscription_status IN ('trial', 'cancelled') THEN u.subscription_status
             ELSE 'active'
           END
      FROM targets t
     WHERE u.id = t.id
     RETURNING u.id
  ),
  logged AS (
    INSERT INTO public.entitlement_migrations (user_id, migration_key)
    SELECT id, 'wc_pass_to_premium_90d' FROM updated
    ON CONFLICT (user_id, migration_key) DO NOTHING
    RETURNING user_id
  )
  SELECT COUNT(*) INTO v_comped_count FROM logged;

  v_skipped_count := GREATEST(v_eligible_count - v_comped_count, 0);

  RAISE NOTICE
    '[065_wc_pass_grandfather_to_premium] eligible=% comped=% skipped_already_comped=%',
    v_eligible_count, v_comped_count, v_skipped_count;
END
$$;

-- ─── 3. Verification snippets (run manually after apply) ──────────────
--
--   -- Count of comps landed under this key
--   SELECT COUNT(*) FROM public.entitlement_migrations
--    WHERE migration_key = 'wc_pass_to_premium_90d';
--
--   -- Sanity: every comped user should now have premium_active_until
--   -- at least 90d out (or later, if they were already annual).
--   SELECT u.id,
--          u.subscription_status,
--          u.premium_active_until,
--          u.wc_pass_active_until
--     FROM public.users u
--     JOIN public.entitlement_migrations em
--       ON em.user_id = u.id
--      AND em.migration_key = 'wc_pass_to_premium_90d'
--    WHERE u.premium_active_until < now() + INTERVAL '89 days';
--   -- expect: 0 rows (all comped users are >= now()+90d)
--
--   -- Idempotency check: re-running this file should NOTICE comped=0.

NOTIFY pgrst, 'reload schema';
