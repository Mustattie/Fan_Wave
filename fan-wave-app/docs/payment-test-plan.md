# Payment Flow E2E Test Plan (FW-106)

> Sandbox-based end-to-end testing for the Premium subscription + WC Pass system. Run this checklist on each sandbox tester (Apple + Google) before submitting to App Store / Play Store review (FW-107).
>
> **Prereqs**: FW-88 + FW-89 dashboard setup complete; `REVENUECAT_WEBHOOK_SECRET` matched between Supabase and RevenueCat.

---

## Setup

1. Install the latest preview APK on test device
2. Sign in with a fresh sandbox tester account (Apple) or license tester (Google)
3. Have the Supabase SQL editor open in another window for live verification

---

## Happy Path

### T1: New user → Trial start
- [ ] Sign up with a new email
- [ ] Complete onboarding (sports, teams, city)
- [ ] **Choose Plan** screen appears (FW-93). Verify both cards: Monthly $9.99/mo and Annual $107.88/yr with "SAVE 10%" badge
- [ ] Tap a plan card → IAP dialog appears with "Free for 7 days, then $X.XX"
- [ ] Confirm the purchase
- [ ] Verify in SQL editor within ~10s:
  ```sql
  SELECT subscription_status, premium_active_until FROM users WHERE auth_id='<your-auth-uid>';
  -- expect: status='trial', premium_active_until = now + 7 days
  ```
- [ ] Verify `entitlements` row inserted:
  ```sql
  SELECT product_id, status FROM entitlements WHERE user_id='<your-auth-uid>';
  -- expect: status='trialing', product_id=premium_monthly_999 (or annual)
  ```
- [ ] Verify `purchase_events` row inserted:
  ```sql
  SELECT event_type, processed FROM purchase_events WHERE user_id='<your-auth-uid>' ORDER BY created_at DESC LIMIT 1;
  -- expect: event_type='INITIAL_PURCHASE', processed=true
  ```

### T2: Trial includes WC tab
- [ ] WC Pass Offer screen appears next (FW-94)
- [ ] Tap "Skip — Maybe Later"
- [ ] Land on Home tab
- [ ] Navigate to World Cup tab — should be fully accessible (trial includes WC)
- [ ] Tap "Join" on any WC fan group → succeeds (no paywall — trial covers WC)
- [ ] Tap RSVP on any WC watch party → succeeds

### T3: Auto-charge after trial
- [ ] In iOS Sandbox: navigate to Settings → App Store → Sandbox Account → manage subscription → set time-zone forward 8 days (or wait for Apple's sandbox accelerated renewal)
- [ ] Verify webhook fires `RENEWAL` event:
  ```sql
  SELECT event_type FROM purchase_events WHERE user_id='<auth-uid>' ORDER BY created_at DESC LIMIT 1;
  -- expect: event_type='RENEWAL'
  SELECT subscription_status, premium_active_until FROM users WHERE auth_id='<auth-uid>';
  -- expect: status='active', premium_active_until = now + ~30 days
  ```
- [ ] Open app → WC tab now requires Pass (paywall opens on RSVP / Join attempt)

### T4: Buy WC Pass post-trial
- [ ] On WC tab, tap RSVP → WCPassPaywall opens
- [ ] Tap "Buy World Cup Pass" → confirm IAP
- [ ] Verify within ~10s:
  ```sql
  SELECT wc_pass_active_until FROM users WHERE auth_id='<auth-uid>';
  -- expect: wc_pass_active_until = ~2026-07-26
  ```
- [ ] WC actions now succeed without paywall

---

## Cancellation Path

### T5: Trial cancellation mid-trial
- [ ] In iOS Settings → Apple ID → Subscriptions → Fan Sphere Premium → Cancel Subscription
- [ ] Verify `CANCELLATION` event:
  ```sql
  SELECT event_type FROM purchase_events ORDER BY created_at DESC LIMIT 1;
  -- expect: event_type='CANCELLATION'
  ```
- [ ] **Important**: `users.subscription_status` should still be `'trial'` (access remains until premium_active_until passes). User keeps trial access.

### T6: Expiration after cancelled trial
- [ ] Advance sandbox time past premium_active_until
- [ ] Verify `EXPIRATION` event:
  ```sql
  SELECT subscription_status, premium_active_until FROM users WHERE auth_id='<auth-uid>';
  -- expect: status='expired', premium_active_until=null
  ```
- [ ] Open app → NavigationGuard routes to /(auth)/resubscribe (FW-113)
- [ ] Resubscribe screen renders correctly:
  - Hero copy
  - Feature recap
  - "Resubscribe" button → PremiumPaywall
  - "Manage in App Store / Google Play" deep link
  - Restore Purchases
  - Sign Out at bottom

### T7: Resubscribe from Resubscribe screen
- [ ] Tap "Resubscribe" → PremiumPaywall opens
- [ ] Complete purchase
- [ ] Realtime entitlement update fires → NavigationGuard routes to /(tabs)
- [ ] User is back in main app

---

## Refund Path

### T8: Apple-side refund
- [ ] Submit a refund via App Store sandbox (this requires the tester to be on a production refund-eligible flow; usually requires real money in sandbox)
- [ ] Verify `REFUND` event:
  ```sql
  SELECT subscription_status, premium_active_until FROM users WHERE auth_id='<auth-uid>';
  -- expect: status='cancelled', premium_active_until=null (immediate revocation)
  ```
- [ ] Next app open → routed to Resubscribe

---

## RLS Negative Tests

### T9: Cancelled user cannot post
- [ ] With status='cancelled' or 'expired', attempt direct SQL insert:
  ```sql
  -- Run as the user's role (use Supabase JS in dev console or auth-as user)
  INSERT INTO media_clips (user_id, title, media_url, media_type) VALUES ('<auth-uid>', 'test', 'x', 'video');
  -- expect: "new row violates row-level security policy for table media_clips"
  ```

### T10: Premium-only user cannot post in WC group
- [ ] With status='active' but wc_pass_active_until=null, attempt to INSERT into match_moments tied to a WC chat_room:
  ```sql
  INSERT INTO match_moments (user_id, chat_room_id, moment_type, comment)
  VALUES ('<auth-uid>', '<wc-chat-room-id>', 'goal', 'test');
  -- expect: RLS denial
  ```

---

## Rate Limit Tests

### T11: Clip post rate limit
- [ ] Post 5 clips in rapid succession (under an hour)
- [ ] On the 6th post, expect Alert: "Slow down — you're posting clips quickly. Try again in a few minutes."
- [ ] Verify check_rate_limit:
  ```sql
  SELECT * FROM rate_limits WHERE user_id='<auth-uid>' AND action='clip_post';
  -- expect: count >= 5
  ```

### T12: Chat message rate limit
- [ ] Send 60 chat messages in under 1 minute
- [ ] On the 61st, message send silently fails (no error UI — fail-quiet by design)
- [ ] Verify the row count for that user's action='message_send' has reached the cap

---

## Idempotency / Webhook

### T13: Replay protection
- [ ] Use RevenueCat dashboard's "Resend event" feature on any historical event
- [ ] Verify `purchase_events` does NOT get a second row (event_id UNIQUE):
  ```sql
  SELECT event_id, COUNT(*) FROM purchase_events GROUP BY event_id HAVING COUNT(*) > 1;
  -- expect: empty result
  ```

---

## Restore Flow

### T14: Fresh install on same account
- [ ] Uninstall app
- [ ] Reinstall fresh APK
- [ ] Sign in with the same email
- [ ] Verify `subscription_status` is preserved (from the DB)
- [ ] Tap "Restore Purchases" — confirm RevenueCat reattaches the existing entitlement

---

## Sign-off

- [ ] All T1–T14 passed on Apple sandbox
- [ ] All T1–T14 passed on Google license tester
- [ ] Negative tests (T9, T10) confirm RLS denies
- [ ] Webhook idempotency (T13) confirms no duplicates
- [ ] Ready to submit to App Store + Play Store review (FW-107)
