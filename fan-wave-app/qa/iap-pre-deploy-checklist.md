# IAP Pre-Deploy QA Checklist

Goal: never ship a build that surfaces "Purchase could not start" or "no singleton instance" to users.

This checklist runs against an **EAS preview build** installed on a **real Android device** (NOT an emulator — Play Billing doesn't work on emulators without GMS). For iOS, the equivalent is TestFlight; the structure is the same but the dashboards differ.

The new `IAP Diagnostics` screen (Profile → IAP Diagnostics) is the one-stop view that answers every yes/no question below. If everything on that screen is green, the build is safe to submit. If anything is red, fix it and re-test before submitting.

---

## Step 0 — Build the preview APK

```powershell
cd C:\Users\tmusa\OneDrive\Documents\Projects\Fan_Wave\fan-wave-app
eas build --profile preview --platform android
```

When the build completes, EAS gives you a downloadable APK URL. Install it on your test device via:

- Open the URL on the device (Chrome will download the APK)
- Tap the file → install (allow "Install unknown apps" for Chrome if prompted)

The preview profile uses the SAME RC keys and prod Supabase as production (see `eas.json` lines 26-39).

## Step 1 — License tester setup (Play Console)

Without this, every purchase attempt returns "billing unavailable" which our code surfaces as "Purchase could not start."

1. Open <https://play.google.com/console>
2. Settings (left rail) → License testing
3. Add the Gmail address that's signed into your test device's Play Store
4. License response: **LICENSED**
5. Save

Verify on the device:
- Settings → Accounts → Google → confirm the licensed-tester Gmail is the active account
- Play Store → Profile icon → confirm the same account

## Step 2 — Verify products in Play Console

`Monetize → Products`:

| Product ID | Type | State |
|---|---|---|
| `premium_monthly_999` | Subscription (base plan: `monthly`, $9.99) | Active |
| `premium_annual_10788` | Subscription (base plan: `annual`, $107.88) | Active |
| `wc_pass_2026` | One-time / In-app product, $19.99 | Active |

If any is in "Draft" or "Inactive", products won't be returned by RC's `getOfferings()` → the debug screen will show "Empty product IDs" in section 2.

Also check that the test track has a release:
- `Testing → Internal testing` → Releases → there must be at least one release rolled out to your test device's track
- The version code matches the APK you just installed

## Step 3 — Verify RC dashboard configuration

Open <https://app.revenuecat.com/projects>:

1. **Apps → Android**:
   - Package name must match `org.fansphere.android` (or whatever is in `app.json`)
   - API key matches what's in `eas.json` (`goog_bZTjvIlQzCauhtncdPYeTjSkJmv` per current config)
   - Play Service Account JSON uploaded and verified (green checkmark)

2. **Products** (RC's "Products" tab):
   - `premium_monthly_999` — Type: Subscription
   - `premium_annual_10788` — Type: Subscription
   - `wc_pass_2026` — Type: Non-consumable
   - Each shows "Synced" / "Available" — if "Unavailable", Play Console linkage is broken

3. **Entitlements**:
   - `premium` — attached to `premium_monthly_999` AND `premium_annual_10788`
   - `wc_pass` — attached to `wc_pass_2026`

4. **Offerings**:
   - At least ONE offering exists
   - That offering is marked as **Current**
   - The offering has Packages mapped: `$rc_monthly` → `premium_monthly_999`, `$rc_annual` → `premium_annual_10788`, custom `wc_pass` → `wc_pass_2026`

5. **Webhooks**:
   - URL: `https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/revenuecat-webhook` (or whatever the function is named)
   - Authorization header includes the shared secret
   - Recent deliveries section shows 200 responses

## Step 4 — Run IAP Diagnostics on device

Install the preview APK, sign in, navigate to **Profile → IAP Diagnostics**.

Expected state for a healthy build (all green):

### Section 1 — RevenueCat SDK
- ✅ API key present (android)
- ✅ Native module loaded
- ✅ Purchases.configure() succeeded
- ✅ Purchases.logIn(userId) succeeded

If any of these is red, the SDK isn't online. Tap "Re-run configure()" — if it stays red, the API key is missing or the native module didn't link. Re-check `eas.json` env vars OR rebuild.

### Section 2 — RevenueCat Dashboard + Play Console wiring
Tap "Probe getOfferings()":
- ✅ getOfferings() returned
- ✅ Current offering exists (`id = default` or your offering's identifier)
- ✅ Packages on current offering (3 packages)
- ✅ Product IDs visible (`premium_monthly_999`, `premium_annual_10788`, `wc_pass_2026`)

If `currentOfferingId` is null → RC dashboard has no "Current" offering set. Fix in Offerings tab.
If `packageCount` is 0 → RC offering has no packages. Fix by adding packages.
If `productIds` is empty → Play Console products not synced. Re-check Step 2.

### Section 3 — Supabase entitlement state
- ✅ users row found
- subscription_status: null (or `trial` after test purchase)
- premium_active_until: null (or future date after test purchase)
- Client says hasPremiumAccess: false (free tier baseline)

If users row is missing → migration 022 trigger didn't fire. Critical bug — fix before launch.

## Step 5 — Live purchase smoke test

Only proceed if Steps 1-4 are all green.

1. On the device, navigate to a paywall screen (e.g. tap Subscription → Start Trial)
2. The real Google Play purchase sheet should open — NOT an error dialog
3. Confirm purchase with the test card (Google Play test purchases bypass actual billing for license-test accounts)
4. On success, return to IAP Diagnostics → Refresh:
   - Section 3 should now show `subscription_status: trial`, `premium_active_until: <date 7 days from now>`
   - Client says hasPremiumAccess: ✅ true

If the purchase sheet opens but Section 3 doesn't update within 30 seconds → RC → Supabase webhook isn't firing. Check the webhook URL in RC dashboard, check the Supabase function logs.

Repeat for the WC Pass screen.

## Step 6 — Restore Purchases test

After the test purchase, sign out and back in. Navigate to Subscription → tap "Restore Purchases". The entitlement should re-attach without re-charging.

## Common failure modes (and fixes)

| Symptom | Likely cause | Fix |
|---|---|---|
| Section 1: API key absent | env vars not in eas.json prod profile | Add to `eas.json` build.production.env |
| Section 1: configure() failed | Older Play Services on device, or AAB unsigned | Rebuild, install fresh, update device Play Services |
| Section 2: Current offering null | RC dashboard has no "current" set | Toggle in Offerings tab |
| Section 2: packageCount = 0 | Offering exists but empty | Add packages mapped to product IDs |
| Section 2: productIds empty | Play Console products not synced / wrong package name | Verify package name matches across app.json, Play Console, RC dashboard |
| Purchase sheet shows "Item unavailable" | Product is Draft, not Active | Activate in Play Console |
| Purchase sheet shows "Authentication required" | Wrong Play account on device | Switch to license tester account |
| Purchase opens but Section 3 stays null | Webhook misconfigured | Check RC dashboard Webhooks → Recent deliveries |

## Sign-off

Build version code: ______
Tester: ______
Date: ______
All sections green: ☐ yes ☐ no
Live purchase succeeded: ☐ yes ☐ no
Webhook → Supabase update: ☐ yes ☐ no
Restore Purchases works: ☐ yes ☐ no

Only check ALL of the above before running `eas submit --profile production`.
