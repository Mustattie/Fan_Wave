# Fan Wave — Payment & Subscription System Design

> **Status**: Design captured for future implementation. Not building now.
> **Action on approval**: Copy this file to `fan-wave-app/docs/payment-system.md` for project-local reference, then return to other work.

---

## Context

Fan Wave needs to monetize before the FIFA World Cup 2026 kickoff (June 11, 2026 — 25 days from 2026-05-17). The product owner wants two SKUs:

1. **Pro subscription** — $12.99/mo or annual, year-round access to premium features
2. **World Cup Pass** — $19.99 one-time, unlocks the World Cup tab for the duration of the tournament (June 11 – July 19, 2026)

The framing "Stripe vs Apple Pay/Google Pay" has a critical misconception worth recording: Apple Pay/Google Pay are wallets for physical goods; the actual choice for in-app digital subscriptions is **Stripe vs Apple IAP / Google Play Billing**. Post-Epic v. Apple (2025), Apple still mandates IAP for in-app digital content — Stripe-only on iOS triggers app rejection. Android (US) allows Stripe directly after Jan 28, 2026 enforcement, but Google still charges a service fee. The compliant cross-platform path is native IAP, abstracted by RevenueCat, with Stripe reserved for web checkout in phase 2.

---

## Decisions (working assumptions, revisit before build)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Payment architecture | **RevenueCat orchestrating native IAP** (Apple IAP + Google Play Billing). Stripe via web in phase 2. |
| 2 | Tier overlap | **Pro subscription includes WC tab access**. WC Pass is the standalone $19.99 entry point. |
| 3 | WC paywall UX | **Browse-only on free tier; gate engagement** (RSVP, create party, join group, post, follow team trigger paywall). |
| 4 | Launch scope | **WC Pass only before kickoff**. Defer Pro monthly/annual to July 2026 post-tournament. |

---

## Multi-discipline analysis

### Payment Systems Expert
- iOS: Apple IAP required for in-app digital subscriptions. External-link allowance (US, 2025) lets you point to Stripe on web, but you must still offer in-app IAP. Stripe-only = rejection.
- Android: Alternative billing (Stripe) legal in US from Jan 28, 2026; Google service fee still applies; rest of world still requires Play Billing.
- Native IAP requires a custom dev client / EAS build — **Expo Go cannot test IAP**. Payment screens require EAS dev build; rest of app stays on Expo Go.
- RevenueCat: 1% fee above $2.5k MTR; handles receipt validation, renewals, refunds, grace periods, family sharing, and emits webhooks. Apple/Google fee: 30% year 1, 15% year 2+ on subscriptions; 30% on one-time IAPs. Apple Small Business Program (<$1M annual) = 15% from day one — Fan Wave qualifies.

### Database Engineer
- Source of truth: a new `entitlements` table written **only** by the webhook handler (service_role). User table holds denormalized columns (`subscription_tier`, `wc_pass_active_until`) for query-time RLS speed.
- Webhook idempotency: `purchase_events` table with `event_id` unique constraint; webhook writes here first, then upserts entitlements.
- Gate WC writes (RSVP, party create, group create, post, follow) with an RLS function `has_wc_access(uid)` returning true when subscription_tier='pro' OR wc_pass_active_until > now().
- WC pass `active_until` = LEAST(purchase_date + 60 days, 2026-07-26) — a one-week buffer past Final.

### UI/UX
- Paywall sheet (not full-screen) so context is preserved when fan-trigger is engagement.
- Three required states: pre-purchase (price + features), processing (loading), success (entitlement confirmed).
- Required Apple UX: "Restore Purchases" button, terms/privacy links, "Subscriptions auto-renew unless cancelled" copy, exact price disclosure.
- Pro badge on profile after purchase. Settings → Subscription screen with "Manage in App Store / Play Store" deep-link (per Apple/Google policy you cannot cancel directly in-app).

### Sport Executive
- WC Pass is a 5-week impulse buy timed to a global event with built-in urgency; $19.99 anchors well against ESPN+ ($11.99/mo), Fubo single match upgrades, Peacock matchday pass.
- Pro at $12.99/mo with ~$99–$129 annual (40% discount) is mid-tier; competitive vs theScore (free, ads), ESPN+ ($11.99), Sports Illustrated digital ($79.99/yr).
- The network-effect features (parties, groups) need free preview so growth doesn't stall — gating engagement (not viewing) preserves DAU growth.

### Corporate Accountant
- Revenue recognition: monthly sub recognized monthly; annual sub deferred and amortized over 12 months; WC Pass deferred and amortized over tournament window (~6 weeks).
- Sales tax: Apple/Google collect and remit globally — zero ops burden. Stripe (web, phase 2) requires Stripe Tax + nexus management.
- Refunds/chargebacks: Apple/Google handle 95% of refund requests automatically; near-zero chargeback exposure vs Stripe.
- Books integration: RevenueCat exports to QuickBooks/Xero; subscriber metrics dashboard ships built-in.
- Net economics per transaction (Small Business Program 15%):
  - $12.99/mo → ~$10.93 net after Apple/Google fee → ~$10.83 after RevenueCat 1%
  - $19.99 WC pass → ~$16.99 net after fee → ~$16.82 after RevenueCat

---

## Implementation outline (for future build, ~25 days estimated for WC Pass MVP)

### Phase A: Backend foundation (3–4 days)
- **Migration `028_entitlements.sql`**:
  - Add `users.subscription_tier TEXT DEFAULT 'free'` (check: `'free' | 'pro'`)
  - Add `users.wc_pass_active_until TIMESTAMPTZ`
  - New table `entitlements` (id, user_id, product_id, source, status, original_transaction_id UNIQUE, expires_at, raw_payload JSONB, created_at, updated_at)
  - New table `purchase_events` (id, event_id UNIQUE, user_id, event_type, payload JSONB, processed BOOLEAN, created_at)
  - RLS: users SELECT own entitlements; INSERT/UPDATE/DELETE service_role only
  - SQL function `public.has_wc_access(uid UUID) RETURNS BOOLEAN`
- **Migration `029_wc_paywall_policies.sql`**: layer `has_wc_access(auth.uid())` checks on existing WC-write policies:
  - `watch_party_rsvps` INSERT (when watch_party.event_id = WC event)
  - `watch_parties` INSERT (when event_id = WC event)
  - `chat_rooms` INSERT (when group_type = 'worldcup')
  - `chat_room_members` INSERT (when chat_rooms.group_type = 'worldcup')
  - `user_team_follows` INSERT (when team.league_id = WC league)
  - `match_moments` INSERT (when chat_room.group_type = 'worldcup')
- **Supabase Edge Function** `revenuecat-webhook/index.ts`:
  - Verify RevenueCat signature header
  - Idempotency-check via `purchase_events.event_id`
  - Map event types (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, NON_RENEWING_PURCHASE for WC pass)
  - Upsert `entitlements` + denormalize to `users.subscription_tier` / `users.wc_pass_active_until`
  - Return 200 fast; never block on slow work

### Phase B: App Store / Play Store config (2–3 days)
- App Store Connect: create non-consumable product `wc_pass_2026` ($19.99 USD, localized 30+ markets)
- Google Play Console: create in-app product `wc_pass_2026` ($19.99)
- Enroll in Apple Small Business Program (15% fee)
- Configure sandbox testers (Apple) and license testers (Google)
- RevenueCat dashboard: create "World Cup Pass" entitlement, link both products, configure webhook → Supabase Edge Function URL with shared-secret header

### Phase C: Mobile app (5–7 days)
- Install: `react-native-purchases` (RevenueCat SDK), `react-native-purchases-ui` for paywall
- Configure RevenueCat in `app/_layout.tsx` initialization with user.id as appUserID
- New files:
  - `lib/entitlements.ts` — hooks: `useHasWCAccess()`, `useSubscriptionTier()`, derived from Supabase `users` row (subscribe via Realtime so post-webhook flips entitlement live)
  - `components/paywall/WCPassPaywall.tsx` — bottom sheet with price, feature list, "Purchase" + "Restore" buttons
  - `components/paywall/PaywallTrigger.tsx` — wrapper that intercepts engagement actions
- Wire paywall triggers in:
  - `WCWatchParties` RSVP + create
  - `WCFanGroups` join + create
  - `WCTeamFollowModal` follow action
  - `MomentsFeed` post (when chat_room is WC)
- Settings → Subscription screen with restore button + manage links
- EAS build profile updates: ensure `expo-dev-client` is the build target for payment testing

### Phase D: Test & ship (4–5 days)
- Sandbox purchase flow on iOS (TestFlight) + Google Play Internal Testing
- Verify webhook → entitlement flow end-to-end
- Verify RLS denies non-entitled writes (negative test)
- Verify "Restore Purchases" path
- Run paywall conversion analytics events through existing `analytics_events` table
- Submit to App Store Review (3–5 days) + Play Store Review (1–3 days)
- **Hard deadline**: in production at least 7 days before June 11, 2026

### Phase E: Pro subscription (deferred to July 2026)
- App Store / Play Store: auto-renewable subscription `pro_monthly` ($12.99) + `pro_annual` ($99 or $129)
- Free trial: 7 days (standard, lifts conversion ~20%)
- Family Sharing enabled
- Bundle WC entitlement so Pro subscribers automatically have WC access (use RevenueCat "offerings" or check tier in `has_wc_access`)
- Stripe web checkout (optional phase F): customer portal for web signup, RevenueCat reconciles via Stripe webhook

---

## Critical files & references

**Existing (read-only references):**
- `fan-wave-app/lib/supabase.ts` — Supabase client, auth session, deep-link callbacks
- `fan-wave-app/app/(tabs)/_layout.tsx` lines 39–87 — WC tab feature flag pattern to layer entitlement on
- `fan-wave-app/app/(tabs)/world-cup.tsx` lines 1–80 — WC tab root
- `fan-wave-app/supabase/migrations/001_base_schema.sql` lines 10–18 — users table to extend
- `fan-wave-app/supabase/migrations/006_world_cup_2026.sql` — WC league/event UUIDs to reference in RLS
- `fan-wave-app/supabase/functions/process-notification-queue/index.ts` — webhook handler pattern to model
- `fan-wave-app/app.json` — bundle IDs `com.fanwave.app` for IAP product setup
- `fan-wave-app/eas.json` — build profiles; production already configured

**Key constants:**
- WC League ID: `b0000000-0000-0000-0000-000000000026`
- WC Event ID: `e0000000-0000-0000-0000-000000002026`
- WC date window: 2026-06-11 to 2026-07-19
- Next migration number: 028

---

## Verification plan (for when we build)

1. **Unit**: SQL function `has_wc_access` returns correct boolean for each tier × WC-pass-expiry combination.
2. **Integration**: Edge function webhook test — fire sample RevenueCat payloads (INITIAL_PURCHASE, RENEWAL, EXPIRATION, REFUND) and assert entitlement state.
3. **E2E sandbox**: TestFlight build — purchase WC pass with sandbox tester, verify `users.wc_pass_active_until` updates within 30s, verify previously-blocked WC actions now succeed.
4. **Negative**: Non-entitled user gets RLS denial on watch_party.rsvp insert; UI shows paywall, not error.
5. **Restore**: Fresh install on same Apple ID restores entitlement without re-purchase.
6. **Refund**: Apple-side refund fires REFUND webhook → entitlement revoked within 1 min → next WC write blocked.
7. **Load**: 1k concurrent webhook events handled without duplicate entitlement writes (idempotency check).
8. **Store review**: Submit and clear App Store + Play Store review without rejection.

---

## Open questions (when we pick this up)

- Free trial length for Pro (7d vs 14d)?
- Annual price — $99 (40% off) or $129 (17% off)?
- WC pass refund policy after kickoff?
- Promo codes / partner comps (e.g., FIFA influencers)?
- Gift purchases / family-sharing scope?
- International pricing tiers (use Apple/Google "price tiers" or set per-region)?
