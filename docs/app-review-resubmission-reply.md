# Apple App Review — Resubmission Reply (build 1.0.0 / 7)

Submission rejected: **7b488909-99fd-4ad6-a02f-6dc566ede858** (build 6)
Date: 2026-06-03

---

## Resolution Center reply (paste into ASC message thread)

Hello App Review,

Thank you for the detailed feedback. We have addressed each issue and are submitting a new build. A summary of changes:

**Guideline 2.1(a) — "irresponsive upon login"**
The root cause was that the In-App Purchase products had not been attached to build 6 (Guideline 2.1(b) below). A fresh account routes through onboarding into the subscription selection screen, and because the IAP products were not available, the paywall could not complete, leaving the reviewer with no path forward. With build 7 the IAP products are attached, and we have also pre-granted the demo account a lifetime entitlement so the reviewer never needs to make a purchase to evaluate the app.

**Guideline 2.1(b) — IAP products not submitted with version**
The three In-App Purchase products (Fan Sphere Premium Monthly $9.99, Premium Annual $107.88, World Cup 2026 Pass $19.99) are now attached to build 7 and submitted alongside the binary.

**Guideline 2.3.10 — non-iOS status bar in screenshots**
All iPhone and iPad screenshots have been recaptured on the iOS simulator (native iOS status bar) and re-uploaded for all required localizations. Any references to third-party platforms have been removed from the screenshots.

**Guideline 5.2.1 — content resembling FIFA**
The single "FIFA World Cup 2026" string in the in-app countdown header has been changed to "World Cup 2026". App Store metadata (description, keywords, subtitle) has been audited; no FIFA marks, logos, or "FIFA" wording appear in the listing or in any in-app assets. The World Cup mode in the app refers to the tournament generically and uses only national team names (which are not FIFA-owned marks).

The demo account is pre-granted entitlements so the reviewer can navigate the full app without making any purchases. Sign-in details and a guided walkthrough are in the App Review Information section.

Thank you,
Tatenda Musara — Fan Sphere

---

## App Review Information (paste into ASC → App Review Information)

**Sign-in required:** Yes
**Demo account:** fansphere.reviewer@gmail.com
**Password:** [insert]

**Notes for reviewer:**
- The demo account is pre-granted a Premium + World Cup Pass entitlement, so you will skip the paywall on sign-in and land directly on the main tabs. No purchase is necessary to evaluate the app.
- To test the paywall flow, sign up with a fresh email; you will be taken through sport / team / city onboarding and then to the plan-selection screen. The "Start 7-day Free Trial" CTA invokes the standard Apple sandbox IAP sheet.
- The "World Cup" tab opens our 2026 tournament hub. The app references the World Cup generically and only uses national team names; no FIFA marks are used.
- ESPN's public sports-data API is used for game schedules. This is disclosed in Settings → Privacy Policy and is a read-only public endpoint with no contractual relationship.

**Test paths to exercise:**
1. Sign in with the demo account → land on Home tab → swipe through Today's Games carousel
2. Tap the "World Cup" tab → countdown / schedule renders
3. Tap "Fan Groups" → join one of the pre-seeded groups, post a chat message
4. Tap "Watch Parties" → RSVP to one of the pre-seeded parties
5. Tap "Profile" → "Subscription" → review plan management screen
6. Sign out → sign up with a fresh email to exercise the new-user onboarding + paywall

---

## Pre-resubmission checklist (operator)

- [ ] Run `fan-wave-app/supabase/scripts/grant_reviewer_premium.sql` against the production Supabase SQL editor; verify the SELECT at the bottom returns one row with status=active and both *_until = 2099.
- [ ] In App Store Connect → My Apps → Fan Sphere → Distribution → In-App Purchases & Subscriptions, confirm each of the three products (premium_monthly_999, premium_annual_10788, wc_pass_2026) is in "Ready to Submit" or "Approved" state, and tick each one in the version-binding section of build 7.
- [ ] Regenerate iPhone (6.7" required) and iPad (13" required) screenshots from the iOS simulator (so the status bar is native iOS, not Android). Replace existing screenshots in ASC for all localizations.
- [ ] Audit App Store description / keywords / subtitle for "FIFA" — remove if present.
- [ ] Run a local end-to-end smoke (sign in with demo account, reach Home tab, open World Cup tab) on the iOS build before re-submitting.
- [ ] Bump build number to 7 in app.json / eas.json and run `eas build --profile production --platform ios` (remember: validation gauntlet first per CLAUDE.md memory).
- [ ] Submit binary + IAPs + updated screenshots together. Paste the Resolution Center reply above into the message thread.
