# Monetization Setup Checklist

> Manual configuration steps that need to be done in **App Store Connect**, **Google Play Console**, and the **RevenueCat dashboard** before the Premium subscription + WC Pass can be sold.
>
> The code side (FW-85, FW-86, FW-87, FW-90+) ships independently of these steps. The app gracefully handles the case where RevenueCat keys aren't configured (`useHasPremium` returns false safely, paywall sheets show a "Configuration error — try again later" state).

---

## FW-88 — App Store / Play Store Product Setup

### Apple App Store Connect

1. **Sign in** to [App Store Connect](https://appstoreconnect.apple.com) with the Apple Developer account that owns `com.fanwave.app`.
2. **Apple Small Business Program** — go to Agreements, Tax & Banking → enroll. Reduces fee from 30% to 15% (Fan Wave qualifies under $1M annual). Allow 1–2 days to verify banking.
3. **Banking + Tax & Agreements** — must be signed before products go live.
4. **Create Subscription Group** (e.g. "Fan Wave Premium").
5. **Create products** inside the group:
   - **`premium_monthly_999`** — auto-renewable subscription, $9.99/mo, **7-day intro free trial offer**
   - **`premium_annual_10788`** — auto-renewable subscription, $107.88/yr, **7-day intro free trial offer**
6. **Create one-time product**:
   - **`wc_pass_2026`** — non-consumable, $19.99
7. **Localizations** — at minimum US English. Use Apple's automatic price tier conversion for other markets.
8. **Sandbox testers** — Users and Access → Sandbox Testers → create at least one (use a non-iCloud email).
9. **Required metadata for each product**: display name, description, screenshot.

### Google Play Console

1. **Sign in** to [Play Console](https://play.google.com/console) with the publisher account for the app.
2. **Mirror the three products** with the same IDs, prices, and trial terms:
   - `premium_monthly_999` — auto-renewing subscription, $9.99/mo, 7-day intro free trial
   - `premium_annual_10788` — auto-renewing subscription, $107.88/yr, 7-day intro free trial
   - `wc_pass_2026` — managed product, $19.99
3. **License testers** — Setup → License testing → add tester accounts.

---

## FW-89 — RevenueCat Dashboard Configuration

1. **Create project** at [app.revenuecat.com](https://app.revenuecat.com) — name "Fan Wave".
2. **Add apps**: iOS bundle `com.fanwave.app`, Android package `com.fanwave.app`.
3. **Entitlements** (under "Entitlements" tab):
   - Create `premium` → attach products `premium_monthly_999` and `premium_annual_10788`
   - Create `wc_pass` → attach product `wc_pass_2026`
4. **Offerings** (under "Offerings" tab):
   - Create offering `default` with the two Premium subscriptions
   - Create offering `wc_pass` with the WC Pass
5. **Upload App Store / Play Store credentials** for receipt validation:
   - Apple: App Store Connect API key (issuer ID, key ID, .p8 file)
   - Google: Play Service Account JSON
6. **Webhook configuration** (Integrations → Webhooks):
   - URL: `https://azkmymxdjylmkytrvyfn.supabase.co/functions/v1/revenuecat-webhook`
   - Auth Header: paste your `REVENUECAT_WEBHOOK_SECRET` here (must match the secret set via `supabase secrets set`)
   - Subscribe to: All event types
7. **Test event** — use RevenueCat's "Send test event" button → verify a row appears in Supabase `purchase_events` table within seconds.

### Setting the webhook secret in Supabase

Generate a UUID locally, then:

```bash
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<paste-uuid-here>
```

And paste the **same value** into the RevenueCat dashboard's Webhook Auth Header field. The two must match exactly or the function returns 401.

---

## FW-105 — Supabase Egress Bandwidth Alerts

In the Supabase dashboard for project `azkmymxdjylmkytrvyfn`:

1. Project Settings → Billing → Usage → Egress
2. Set alert at **70%** of monthly bandwidth → email on-call
3. Set alert at **90%** → email on-call + product owner
4. Document the response in `docs/runbooks.md`: "If 90% alert fires, evaluate (a) upgrading Supabase plan tier for the month, or (b) accelerating Cloudinary migration from FW-E18".

---

## FW-107 — App Store + Play Store Submission

1. **Production EAS build** triggered via `eas-cli build --platform android --profile production` (and iOS equivalent when iOS is in scope)
2. **App Store screenshots** updated:
   - Choose Plan screen
   - Premium paywall
   - WC Pass paywall
   - WC Schedule with FINAL/LIVE labels
3. **App Store metadata** updated:
   - Description must disclose subscription pricing ($9.99/mo or $107.88/yr) and 7-day free trial
   - Privacy policy link, Terms of Service link (Apple required)
   - "Auto-renewable subscriptions" copy
4. **Play Store metadata** updated similarly
5. **App Review notes**:
   - Explain subscription model
   - Provide sandbox/license tester credentials for the reviewer to test
   - Confirm "Restore Purchases" works on a fresh install with the same account
6. **Hard deadline**: submit by **June 4, 2026** (5 days before WC kickoff on June 11) to absorb 3–5 day Apple review + 1–3 day Google review.
7. Live in production by **June 6, 2026**.

---

## Verification once everything is connected

- [ ] Send a test event from RevenueCat → row appears in Supabase `purchase_events` table
- [ ] Sandbox tester starts a trial in TestFlight → `users.subscription_status='trial'`, `premium_active_until` set ~7 days out
- [ ] Sandbox tester advances clock 7 days → next renewal event fires → `users.subscription_status='active'`
- [ ] Sandbox tester cancels in App Store settings → `entitlements.status='cancelled'` but `users.subscription_status` stays `'active'`
- [ ] After expiration date passes → `users.subscription_status='expired'`, `premium_active_until` is null
- [ ] Apple-side refund → `users.subscription_status='cancelled'`, columns cleared, access revoked within ~1 minute
