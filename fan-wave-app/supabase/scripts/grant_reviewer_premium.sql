-- grant_reviewer_premium.sql
--
-- Purpose: pre-grant the App Store / Play Store review account a permanent
-- entitlement so the reviewer never hits the paywall when testing the build.
-- Apple's 2.1(a) rejection of submission 7b488909 was caused by the reviewer
-- being trapped on the choose-plan paywall (no IAPs in build + no demo
-- bypass = "app irresponsive upon login").
--
-- Run this against the PRODUCTION Supabase project via the SQL Editor
-- (NOT psql / Studio) so it executes as supabase_admin and bypasses the
-- migration 040 immutability trigger.
--
-- The grant runs to 2099 so it does not silently expire mid-review and
-- re-trigger the paywall in a future cycle.

UPDATE users
SET
  subscription_status   = 'active',
  premium_active_until  = TIMESTAMPTZ '2099-12-31 23:59:59+00',
  wc_pass_active_until  = TIMESTAMPTZ '2099-12-31 23:59:59+00'
WHERE auth_id = (
  SELECT id FROM auth.users WHERE email = 'fansphere.reviewer@gmail.com'
);

-- Verify (expect one row, status=active, both *_until in 2099)
SELECT
  u.display_name,
  au.email,
  u.subscription_status,
  u.premium_active_until,
  u.wc_pass_active_until,
  u.onboarded_at
FROM users u
JOIN auth.users au ON au.id = u.auth_id
WHERE au.email = 'fansphere.reviewer@gmail.com';
