# Monetization Setup Checklist

> Manual configuration in **App Store Connect**, **Google Play Console**, and the
> **RevenueCat dashboard**. Nothing on the tiered plans can be sold until every
> step here is done.
>
> **Current as of v9.4.8 (2026-08-27).** FW-89 is done — see
> [Blocking state](#blocking-state--read-first). This doc previously described
> the pre-v9.3 flat `$9.99 Premium` model and pointed the webhook at the retired
> legacy Supabase project. Both were wrong; see [Legacy products](#legacy-products-do-not-sell).

---

## Blocking state — read first

**RevenueCat (FW-89) is configured** as of 2026-08-26, by
`scripts/setup-revenuecat.mjs` run against project `proja57677fc`. The `default`
offering — the only one the client reads — now serves exactly four packages, each
carrying both platform rows:

```
home_team_monthly   ios home_team_monthly_499    android home_team_monthly_499:monthly
home_team_annual    ios home_team_annual_3499    android home_team_annual_3499:annual
mvp_monthly         ios mvp_monthly_1499         android mvp_monthly_1499:monthly
mvp_annual          ios mvp_annual_9999          android mvp_annual_9999:annual
```

Entitlement `home_team` holds all eight products (both tiers — MVP is additive);
`mvp` holds the four `mvp_*` rows. The legacy `$rc_monthly` / `$rc_annual` /
`wc_pass` packages were deleted from the offering; their products and the
`premium` entitlement remain, so restore-purchases still grandfathers
`premium_*` holders up to `mvp`.

**Cleared since** (2026-08-27):

- **Webhook** — "Fan Sphere Prod — Supabase" now points at prod
  `fwlfiejvxmslkpoojggs`, all events, Production **and** Sandbox. Its test event
  returned `200 {"ok":true,"ignored":"TEST"}` and landed a `purchase_events`
  row. A second webhook aimed at the retired `azkmymxdjylmkytrvyfn` had been
  live the whole time; it was deleted.
- **Apple store credentials** — both RevenueCat slots filled. They take two
  *different* keys; see [FW-89 step 4](#fw-89--revenuecat-dashboard-configuration).
- **The Home Team 7-day trial is live on Play.** `freetrial7` is ACTIVE on both
  `home_team_monthly_499:monthly` and `home_team_annual_3499:annual` — one
  P7D free phase across 173 regions, targeting `thisSubscription`, identical
  on both plans. `check-play-catalog.mjs` reports 0 problems.
- **Google Play service account credentials** — `play-store-key.json` uploaded
  to RevenueCat, which reports **Valid credentials**. The grants were given at
  **app** scope (Play Console → Users and permissions → the service account →
  **App permissions** → Fan Sphere), not account scope: View app information,
  View financial data, Manage orders and subscriptions, Manage store presence.
  Both endpoints RevenueCat validates receipts through now answer
  (`subscriptionsv2.get` 400 on a junk token, `voidedpurchases.list` 200).
- **Apple Server Notifications V2 are live for sandbox** (2026-08-30). Both ASC
  URL fields carry the RevenueCat endpoint; Apple's own test notification
  reported `sendAttemptResult=SUCCESS`, `notificationType=TEST`,
  `environment=Sandbox`. Sandbox is the environment UAT purchases run in, so
  this is the half that matters before a build. Production could not be tested —
  see [Verifying ASSN](#verifying-assn-with-apples-own-test-notification).
- **Android real-time developer notifications are live** (2026-08-28). Topic
  `projects/fan-sphere-prod/topics/play-rtdn`; RevenueCat created its own puller
  `RevenueCat-Subscriber-app52bb277597` on it. A Play Console test notification
  went end to end — see [Verifying RTDN](#verifying-rtdn-without-trusting-a-dashboard).

**Still blocking a sale**, and none of it is scriptable:

0. *(**Android is done end to end** as of 2026-08-28 — catalogue, trial,
   receipt validation and notifications. Everything below is iOS.)*

1. **iOS products are Missing Metadata.** Each of the four needs a Review
   Information **screenshot**. Chicken-and-egg: no screenshot → not Ready to
   Submit → StoreKit serves no price → the paywall reads `Unavailable`. Break it
   with a provisional image — Apple does not validate the contents before
   submission. `play-store-screenshots/paywall_apple_review.png` predates the
   tiers and shows the old $9.99 sheet: good enough to unblock, must be replaced
   with real tier screenshots before FW-107.
2. *(Apple Server Notifications V2 — **done 2026-08-30**, sandbox verified by
   Apple; see [Verifying ASSN](#verifying-assn-with-apples-own-test-notification).)*

Until those, the client **fails closed**: a tier whose own SKU resolves to no
package renders `Unavailable` with a disabled CTA and no billing disclosure.
That is deliberate — before v9.4.5 the client fell back to the legacy
`$rc_monthly` / `$rc_annual` packages, so a "Home Team $34.99/yr" tap actually
bought `premium_annual_10788` and charged **$107.88**. Zero revenue beats
mis-billing.

---

## The products the code expects

Source of truth: `lib/entitlements.ts` (`TIER_PRODUCT_IDS`,
`TIER_ENTITLEMENT_ID`), `supabase/functions/revenuecat-webhook/index.ts`
(`HOME_TEAM_PRODUCTS`, `MVP_PRODUCTS`), migration `082_subscription_tiers.sql`.

| Tier | Plan | Product ID | Price | Free trial |
|---|---|---|---|---|
| Home Team | monthly | `home_team_monthly_499` | $4.99 / mo | 7 days |
| Home Team | annual | `home_team_annual_3499` | $34.99 / yr | 7 days |
| MVP | monthly | `mvp_monthly_1499` | $14.99 / mo | none |
| MVP | annual | `mvp_annual_9999` | $99.99 / yr | none |

Prices above are the *intended* US prices and must be entered in the stores.
They are **not** shipped as strings the user sees: since v9.4.5 the paywall
renders `product.priceString` off the very package `purchaseTier()` would buy
(`getTierPrice()`), so whatever you type into App Store Connect / Play *is* what
the UI displays, localised. If the store price and the table above disagree, the
store wins on screen — fix the store, not the code.

`business` is a valid tier in the DB CHECK and `TIER_RANK`, reserved for manual
grants (venues / partners). It has no store product and no paywall.

---

## FW-88 — App Store / Play Store product setup

### Apple App Store Connect

1. **Sign in** to [App Store Connect](https://appstoreconnect.apple.com) with the
   account that owns `org.fansphere.app` (`ascAppId` 6774325670).
2. **Apple Small Business Program** — Agreements, Tax & Banking, then enroll.
   30% to 15%. Allow 1-2 days for banking verification.
3. **Banking + Tax & Agreements signed.** An expired agreement also breaks
   `eas submit` with `403 REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`.
4. **One subscription group** (e.g. "Fan Sphere") holding all four subscriptions,
   so upgrade/downgrade between Home Team and MVP is a store-managed change
   rather than two parallel subscriptions.
   - Ranking inside the group: **MVP above Home Team**. Level order is what makes
     Home Team to MVP an immediate upgrade with proration.
5. **Create the four auto-renewable subscriptions** exactly as named in the table
   above. Per product: reference name, duration, US price, display name,
   description, review screenshot. The **review screenshot is what holds a
   product at Missing Metadata**, and Missing Metadata means StoreKit serves no
   price at all — the paywall reads `Unavailable` on a real device even when
   RevenueCat is configured correctly. Upload a provisional image to break that
   loop; contents are not validated until submission.
6. **Introductory offer — 7-day free trial on the two `home_team_*` products only.**
   MVP has `offersTrial: false` in `TIER_CONFIG`; adding a trial there would make
   the paywall copy ("Subscribe", no trial disclosure) wrong.
7. **Localizations** — US English minimum; use Apple's automatic price conversion
   elsewhere. The client shows RevenueCat's localised `priceString`, so converted
   prices surface correctly with no code change.
8. **Sandbox tester** — Users and Access, Sandbox Testers. Use a **non**
   `fansphere.reviewer@gmail.com` account: the reviewer account is entitlement-
   bypassed on both client and server, so it can never exercise a real purchase.
9. **Attach the subscriptions to the build** in the version's In-App Purchases
   section before submitting, or review rejects the metadata.
10. **App Store Server Notifications V2** — done 2026-08-30. Without it RC
    learns of cancellations and billing failures only on its own polling
    schedule, so `EXPIRATION` reaches the webhook late and access is revoked
    late.
    - Easiest path: RevenueCat → Apps → the iOS app → **Apple Server to Server
      notification settings** → **Apply in App Store Connect**. That fills
      production *and* sandbox itself, using the App Store Connect API key added
      on 2026-08-27 — which is the reason this button works now and did not
      before.
    - Manual equivalent: copy the URL from that same panel, then App Store
      Connect → the app → **App Information → App Store Server Notifications**,
      paste it into **both** the Production and Sandbox Server URL fields and
      pick **Version 2**.
    - Apple stores exactly **one** URL per environment. If anything else is
      already listening there, point Apple at RevenueCat and use RC's
      forwarding rather than trying to fan out from Apple.

### Google Play Console

1. **Sign in** to [Play Console](https://play.google.com/console) for `org.fansphere.app`.
2. **Mirror all four subscriptions** with the same product IDs, prices, and the
   Home-Team-only 7-day trial.
3. Play subscriptions carry **base plans**, and the ID is **load-bearing**. Name
   them exactly `monthly` and `annual`. RevenueCat addresses a Play product as
   `{productId}:{basePlanId}`, so the base plan ID is embedded in the RC
   `store_identifier` (`home_team_monthly_499:monthly`) and in `BASE_PLAN` in
   `scripts/setup-revenuecat.mjs`. Rename a base plan and the RC row points at a
   Play SKU that does not exist: the package comes back priceless,
   `getTierPrice()` returns `{ available: false }`, and the paywall reads
   `Unavailable` with nothing logged. The *client* tolerates the suffix fine —
   `findPackageForTierPlan` and the webhook's `baseProductId` normalisation both
   split on `:` — but only if the RC row resolves in the first place.
4. **Grace period**, account hold left enabled. As configured: **7 days** on
   both monthly base plans, **14 days** on both annual ones (Google's own
   recommendation for yearly). Longer grace is strictly more recovery time.
   The webhook holds access on `BILLING_ISSUE` and only revokes on `EXPIRATION`
   (`revenuecat-webhook/index.ts:107`), so the grace window is real recovery
   time, not free access.
5. **License testers** — Setup, License testing.

---

## FW-89 — RevenueCat dashboard configuration

> **Steps 1–3 are done** — applied by `scripts/setup-revenuecat.mjs` on
> 2026-08-26. Re-running it is safe and idempotent (GET-first, matched on
> `lookup_key` / `store_identifier`); use a dry run to audit drift:
>
> ```bash
> # from fan-wave-app/, with RC_SECRET_KEY + RC_PROJECT_ID in .env.revenuecat
> node --env-file=.env.revenuecat scripts/setup-revenuecat.mjs          # dry run
> node --env-file=.env.revenuecat scripts/setup-revenuecat.mjs --apply  # write
> ```
>
> The key must be a **v2 secret key** (`sk_`) with `read_write` on
> `project_configuration`. **Steps 4–6 remain manual** and are what still block a
> sale.

1. **Project** "Fan Sphere" at [app.revenuecat.com](https://app.revenuecat.com);
   apps for iOS bundle `org.fansphere.app` and Android package `org.fansphere.app`.
   Public SDK keys already shipped in `eas.json` (preview + production):
   `appl_JmblLQHAuNHfPBzUQkjBzKmROAM`, `goog_bZTjvIlQzCauhtncdPYeTjSkJmv`.
2. **Entitlements** — identifiers must match `TIER_ENTITLEMENT_ID` exactly:
   - `home_team` — attach `home_team_monthly_499`, `home_team_annual_3499`, **and**
     both `mvp_*` products. MVP is additive: `purchaseTier('mvp', …)` accepts
     either `mvp` or `home_team` as the success signal, and every Home Team perk
     is inherited by MVP.
   - `mvp` — attach `mvp_monthly_1499`, `mvp_annual_9999`.
3. **Offering `default`, set as current.** The client reads `offerings.current`
   only. It must carry all four packages.
   - Package identifiers: `home_team_monthly`, `home_team_annual`, `mvp_monthly`,
     `mvp_annual` (`{tier}_{plan}` — the first lookup `findPackageForTierPlan`
     tries). If you use RevenueCat's built-in `$rc_monthly` / `$rc_annual`
     identifiers instead, the lookup still succeeds via exact product-ID match —
     but only one tier can own `$rc_monthly`, so custom identifiers are required
     for four SKUs.
   - **Do not** put a legacy `premium_*` product in the current offering. There is
     no longer a fallback that would resolve to it, so it cannot mis-bill any more;
     it would simply show up as a purchasable plan the app has no UI for.
4. **Store credentials** for receipt validation. The iOS app needs **both**
   Apple slots and they take **different** keys — an empty App Store Connect API
   slot makes every product read "Could not check", including known-good legacy
   ones, which reads like a product problem and is not one. Both filled
   2026-08-27:
   - **In-app purchase key** — `SubscriptionKey_A4TF99P3RW.p8`, Key ID
     `A4TF99P3RW`.
   - **App Store Connect API key** — `AuthKey_DP56C6TV9V.p8`, Key ID
     `DP56C6TV9V`, Issuer ID `e60d3fc7-a3e5-4eb4-8fcf-1e2c155ff7a4`. The issuer
     ID is team-wide, not per-key. RevenueCat wants the file under its downloaded
     `AuthKey_XXXXXXXXXX.p8` name. **Do not revoke `DP56C6TV9V`** —
     `eas.json:67` submits with it.
   - **Google: Play service account JSON — still empty.** Do **not** create a
     new service account: `fan-sphere-play-submitter@fan-sphere-prod.iam.gserviceaccount.com`
     already exists, its key is at `fan-wave-app/play-store-key.json`
     (gitignored, used by `eas submit`), and it authenticates fine. What it
     lacks is permission — it can read the catalogue but not purchases. Three
     steps:
     1. **GCP project `fan-sphere-prod`** — enable **Google Play Android
        Developer API** (already on, or the catalogue read would fail),
        **Google Play Developer Reporting API**, and **Cloud Pub/Sub API**
        (the last is what carries real-time developer notifications). Grant the
        service account **Pub/Sub Editor** and **Monitoring Viewer**.
     2. **Play Console → Users and permissions → the service-account email →
        Account permissions.** Tick "View app information and download bulk
        reports (read-only)", "View financial data, orders, and cancellation
        survey responses", **"Manage orders and subscriptions"**, and "Manage
        store presence". Missing the orders grant is not a soft failure: Google
        auto-refunds any purchase the app never acknowledges, three days after
        the charge.
     3. **RevenueCat → Project Settings → Google Play App Settings → Service
        account credentials** — upload `play-store-key.json` as-is.
     Then re-run `node scripts/check-play-catalog.mjs`; the two permission
     probes must stop returning 401. Google's grant propagation is slow —
     RevenueCat's own docs allow **up to 36 hours**, with 503/521 from the
     dashboard in the meantime — so a still-failing probe minutes later means
     wait, not misconfigured.
5. **Webhook** (Integrations, Webhooks) — **done and verified 2026-08-27**,
   named "Fan Sphere Prod — Supabase", subscribed to all events, Production and
   Sandbox both on. HMAC signing is enabled but the function does **not** verify
   the signature; it gates on `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`
   only, so that header is the whole authentication story.
   - URL: `https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/revenuecat-webhook`
     — the **production** project. Anything pointing at `azkmymxdjylmkytrvyfn` is
     the retired legacy project: purchases would validate, users would be charged,
     and no entitlement row would ever land in prod.
   - Auth Header: the `REVENUECAT_WEBHOOK_SECRET` value (below). Mismatch is a 401.
   - Subscribe to **all** event types. `PRODUCT_CHANGE` is what carries tier
     upgrades/downgrades, and `EXPIRATION` / `REFUND` are what drop
     `subscription_tier` back to `free`.
6. **Test event** — RevenueCat's "Send test event", then confirm a row in prod
   `purchase_events` within seconds. Done 2026-08-27: `200
   {"ok":true,"ignored":"TEST"}`, row present. That does **not** cover the
   derived write to `users` (`subscription_status`, `subscription_tier`,
   `premium_active_until`), because the function ignores `TEST` events by design.
   Only a real sandbox purchase exercises it.

### Setting the webhook secret

```bash
# from fan-wave-app/, against the PROD project
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<uuid> --project-ref fwlfiejvxmslkpoojggs
```

Paste the identical value into RevenueCat's Webhook Auth Header. Rotated
2026-08-27; it lives in exactly **two** places — Supabase Edge Function Secrets
and the RevenueCat webhook's Edit button. Change one without the other and every
purchase 401s silently. Check
`docs/env-swap-runbook.md` if you rotate it — the same secret-vs-dashboard drift
that produced the "ESPN sync 401" class of bug applies here.

---

## Android RTDN setup

Done 2026-08-28. Recorded because roughly none of it is guessable and every
step failed in a way that looked like a different step's fault.

1. **GCP project `fan-sphere-prod`** (number `1066537752604`) — enable **Cloud
   Pub/Sub API** and **Play Developer Reporting API**. Both were off, which is
   what the "Google … must be enabled" error on first saving the RevenueCat
   credentials actually meant.
2. **Create the topic** — `play-rtdn`, defaults fine. Full name
   `projects/fan-sphere-prod/topics/play-rtdn`.
3. **Two grants, at two different scopes**, and mixing them up produces the
   same opaque 403 either way:
   - On the **topic**: `google-play-developer-notifications@system.gserviceaccount.com`
     as **Pub/Sub Publisher**. That is Google's own identity — it is what
     publishes the notifications.
   - On the **project** (IAM page, not the topic):
     `fan-sphere-play-submitter@…` as **Pub/Sub Editor** + **Monitoring Viewer**,
     so RevenueCat can enumerate topics and create its subscription.
   - **Do not pick "Pub/Sub Lite Editor".** It sorts next to the right one in
     the role picker, is a different and deprecated product, grants nothing on
     regular Pub/Sub, and cost an hour here. The symptom is
     `IAM_PERMISSION_DENIED` on `pubsub.topics.list` while the IAM page shows a
     Pub/Sub-looking role sitting right there.
4. **RevenueCat → Apps → Fan Sphere Android → Google developer notifications** —
   pick the topic, **Connect to Google**. If the dropdown is empty, RevenueCat
   cached its topic list from before the Editor grant existed: re-validate with
   the refresh control beside "Valid credentials" and reload.
5. **Play Console → Monetize → Monetization setup → Real-time developer
   notifications** — tick Enable, paste the full topic name, content type
   **Subscriptions and voided purchases only** (the one-time product
   `wc_pass_2026` is retired, and that option covers voided one-time purchases
   anyway), **Save**, then **Send test notification**. Save before testing: the
   test publishes to the saved value.

### Verifying RTDN without trusting a dashboard

RevenueCat showing "Last received" is a claim. Cloud Monitoring is evidence, and
the Monitoring Viewer grant from step 3 is what makes it readable:

```
pubsub.googleapis.com/topic/send_message_operation_count   topic_id=play-rtdn
pubsub.googleapis.com/subscription/sent_message_count      subscription_id=RevenueCat-Subscriber-app52bb277597
pubsub.googleapis.com/subscription/num_undelivered_messages
```

The 2026-08-28 test read 1 published, 1 delivered, 0 undelivered — published but
not delivered would be RevenueCat's end; nothing published at all would be the
Play Console test or the publisher grant. Metrics lag one to three minutes.

---

## The iOS catalogue, and what "Missing Metadata" actually meant

All four products reached **READY_TO_SUBMIT** on 2026-08-31. The review
screenshot was one of *four* missing things, and the technique that found the
rest is worth more than the list: **diff a stuck product against a working
one.** `premium_monthly_999` was READY_TO_SUBMIT the whole time, so every
difference between it and `home_team_monthly_499` was a candidate.

1. **Review screenshot** — uploaded via
   `POST /v1/subscriptionAppStoreReviewScreenshots` → PUT each uploadOperation
   → PATCH `uploaded:true` with the file's md5 as `sourceFileChecksum`.
2. **`reviewNote` was null.** Apple wants notes *and* a screenshot. The notes
   now describe what each tier unlocks and the exact path to each paywall.
3. **The subscription group had no localization.** The new "Fan Sphere" group
   (22335867) had zero `subscriptionGroupLocalizations`. A group with no
   display name holds *every product inside it* at Missing Metadata — the
   products themselves look complete while the container is not.
4. **The annual products had no `subscriptionAvailability` at all** — HTTP
   **404**, not an empty list. This is why the monthlies cleared first and the
   annuals did not. Created against the same 175 territories.

### Introductory offers are per-territory

The 7-day Home Team trial exists on iOS as of 2026-08-31: **175 offers per
product**, one per available territory, because that is how Apple models them —
`premium_monthly_999` carries 175 rows too, not one global offer. Creating a
single USA offer leaves the trial undefined everywhere else, which reads as
"trial configured" in a spot check and charges day zero for most of the world.

```
POST /v1/subscriptionIntroductoryOffers
  attributes:    { duration: ONE_WEEK, offerMode: FREE_TRIAL, numberOfPeriods: 1 }
  relationships: { subscription, territory }
```

`mvp_*` deliberately has **zero** offers: `offersTrial: false` for that tier, and
an offer there would make the paywall's "Subscribe" copy false in the other
direction.

**ASC JWTs expire at 20 minutes, maximum.** A token minted with `exp: now+1800`
is rejected with a 401 that reads like a bad key — the error says "properly
configured and signed", not "expired too far out". Use 900–1140 seconds.

---

## Verifying ASSN with Apple's own test notification

App Store Connect has no "send test" button, so the usual way to discover a
broken notification URL is a sandbox purchase that never lands. The App Store
Server API will do it on demand instead:

```
POST /inApps/v1/notifications/test           -> { testNotificationToken }
GET  /inApps/v1/notifications/test/{token}   -> Apple's delivery result
```

`scripts/` has no wrapper for this yet; the working script lived in the
scratchpad for the 2026-08-30 check. What matters is the auth, which is easy to
get wrong: it needs the **In-App Purchase key** (`SubscriptionKey_A4TF99P3RW.p8`,
key ID `A4TF99P3RW`) — *not* the App Store Connect API key `AuthKey_DP56C6TV9V.p8`
that `eas submit` uses. ES256, `aud: appstoreconnect-v1`, `bid: org.fansphere.app`,
issuer `e60d3fc7-a3e5-4eb4-8fcf-1e2c155ff7a4`, and the signature must be raw
`r||s` (`dsaEncoding: 'ieee-p1363'`), not DER.

Hosts: `api.storekit-sandbox.itunes.apple.com` and `api.storekit.itunes.apple.com`.

Reading the results:

- `404 errorCode 4040007` — **no URL configured for that environment**. This is
  an app-level answer, not an auth failure, and it is how the missing *sandbox*
  URL was caught on 2026-08-30 after RevenueCat's "Apply in App Store Connect"
  appeared to have filled both. Do not trust the dashboard here; ask Apple.
- `sendAttemptResult=SUCCESS` — Apple delivered and the endpoint accepted it.
- `401` on **production only**, while sandbox authenticates with the same JWT —
  most likely because the app has never been released to the App Store (only
  TestFlight; build 11 was rejected). Re-test after the first release. It does
  not block UAT: sandbox is where test purchases live.

---

## Auditing the Play catalogue

```bash
# from fan-wave-app/ — read-only, reads ./play-store-key.json
node scripts/check-play-catalog.mjs
```

Exits non-zero with a list of problems. It checks the four base plans exist
under the exact `monthly` / `annual` IDs RevenueCat addresses them by, that the
US price matches what the paywall prints, that a tier promising a trial actually
serves an **ACTIVE** offer, and that the service account can reach the two
purchase endpoints RevenueCat validates receipts with.

The offer check is the reason it exists. Play Console shows a base plan as a
green **Active** while its free-trial offer sits in **Draft** one screen deeper,
and a Draft offer is simply not served — the paywall keeps promising seven free
days and Play charges immediately, with no error anywhere.

---

## Legacy products (do not sell)

Kept in the lookup tables for restore-purchases and grandfathering only. None
belong in the current offering.

| Product | Was | Now |
|---|---|---|
| `premium_monthly_999` | $9.99/mo flat Premium | webhook maps to tier `mvp` (grandfathered upward) |
| `premium_annual_10788` | $107.88/yr flat Premium | webhook maps to tier `mvp` |
| `wc_pass_2026` | $19.99 World Cup pass | not sold; sets `wc_pass_active_until` only. WC ended 2026-07-26 |

The v9 pivot made the app year-round multi-sport, so there is no WC Pass paywall
left to reach. Existing holders keep their access via `has_wc_access`.

---

## Android subscription replacement

**Fixed in v9.4.7.** Play has no subscription groups, so the four SKUs are four
independent subscriptions: buying a second while the first is live leaves both
active and bills both, with no error raised and no store warning. iOS is immune —
all four sit in one subscription group with MVP ranked above Home Team, so the
App Store performs the swap itself.

`purchaseTier` now declares what the purchase replaces:

```
purchasePackage(pkg, null, { oldProductIdentifier, replacementMode })
```

The decision lives in `lib/androidReplacement.ts` (`chooseAndroidReplacement`),
covered by `__tests__/androidReplacement.test.ts`:

| Situation | Result |
|---|---|
| No active subscription | no replacement — declaring one makes Play reject the purchase |
| Already on the target product | no replacement — Play rejects replacing a subscription with itself |
| Home Team → MVP, or monthly → annual | upgrade → `WITH_TIME_PRORATION` (immediate, unused time credited) |
| MVP → Home Team, or annual → monthly | downgrade → `DEFERRED` (takes effect at renewal, matching iOS) |
| Grandfathered `premium_*` → `mvp_*` | downgrade/lateral — `premium_*` ranks as MVP, since that is what the webhook grandfathers it to |
| Several active (an account that already hit the bug) | replaces the **most valuable** one; replacing the cheap one would leave the expensive one billing |

Two notes for anyone touching this:

- `purchasePackage`'s **second** parameter is the deprecated `UpgradeInfo`;
  product change info is the **third**. Passing it second binds to the legacy
  shape and the replacement is silently ignored.
- `WITH_TIME_PRORATION`, not `CHARGE_PRORATED_PRICE` — Play only accepts the
  latter for upgrades that keep the same billing period, so Home Team monthly →
  MVP annual would fail.

Still needs on-device UAT: it cannot be exercised in Expo Go, and a sandbox
account must hold a live Home Team subscription before the MVP tap means
anything.

---

## FW-105 — Supabase egress bandwidth alerts

In the Supabase dashboard for **`fwlfiejvxmslkpoojggs`** (prod):

1. Project Settings, Billing, Usage, Egress
2. Alert at **70%** of monthly bandwidth — email on-call
3. Alert at **90%** — email on-call + product owner
4. Response documented in `docs/runbooks.md`: at 90%, either upgrade the plan tier
   for the month or accelerate the CDN / Cloudinary migration.

Clip storage is the dominant term. v9.4.4 cut capture bitrate and purged 156 MB of
orphaned objects; `supabase/scripts/find_orphaned_clip_objects.sql` is the
recurring check.

---

## FW-107 — Store submission

1. Production build: `eas build --platform android --profile production` (and the
   iOS equivalent). Preview and production both carry `autoIncrement: true` plus
   `cli.appVersionSource: "remote"`, so builds replace installs instead of
   silently keeping old code.
2. **Screenshots** — Choose Plan, Home Team paywall, MVP paywall, a live Watch
   Party, Discover. iOS screenshots must come from an iOS device or simulator.
3. **Metadata must disclose the real terms**: $4.99/mo or $34.99/yr Home Team with
   a 7-day free trial; $14.99/mo or $99.99/yr MVP with no trial; auto-renewable;
   privacy policy and terms links. Advertising a price the store does not charge is
   exactly the v9.4.5 defect, in metadata form.
4. Do not submit while the paywall reads "Plans are temporarily unavailable" —
   review will treat a non-functional purchase flow as a broken feature.

---

## Verification before flipping this live

- [ ] All four products **Ready to Submit** / **Active** in ASC and Play
- [x] `home_team` and `mvp` entitlements attached per FW-89 step 2 — 2026-08-26
- [x] `default` offering is **current** and lists four packages — 2026-08-26
- [x] Webhook points at prod, all events, both environments; test event landed a
      `purchase_events` row — 2026-08-27
- [x] Apple in-app-purchase key **and** App Store Connect API key both in
      RevenueCat — 2026-08-27
- [x] Play base plans all **ACTIVE** at 4.99 / 34.99 / 14.99 / 99.99 USD, base
      plan IDs `monthly` / `annual` as RevenueCat addresses them — 2026-08-27
- [x] Home Team trial offers **ACTIVE** on both base plans, one P7D free phase
      across 173 regions, identical shape on monthly and annual — 2026-08-27
- [x] Google Play service account JSON in RevenueCat, reporting **Valid
      credentials**; `check-play-catalog.mjs` reports 0 problems — 2026-08-27
- [x] Cloud Pub/Sub + Play Developer Reporting APIs enabled in `fan-sphere-prod`,
      RTDN topic connected, Play test notification observed published **and**
      delivered in Cloud Monitoring — 2026-08-28
- [x] App Store Server Notifications V2 URL set for production and sandbox;
      Apple's test notification returned SUCCESS for sandbox — 2026-08-30
- [ ] Production ASSN re-tested after the app's first App Store release
      (production endpoint 401s for never-released apps)
- [ ] Paywall on a real device shows live prices, not `Unavailable`
- [x] iOS 7-day trial configured on both `home_team_*` products across all 175
      territories; `mvp_*` correctly has none — 2026-08-31
- [ ] Displayed price equals charged price on a sandbox purchase of each of the four
- [ ] Home Team to MVP upgrade lands `subscription_tier = 'mvp'` in prod `users`
- [ ] **Android**: after that upgrade, Play shows exactly **one** active
      subscription, not two (see [Android subscription replacement](#android-subscription-replacement))
- [ ] Cancel, then `EXPIRATION`, drops the tier back to `free` and re-gates the UI
- [ ] Restore purchases on a grandfathered `premium_*` account still grants `mvp`
