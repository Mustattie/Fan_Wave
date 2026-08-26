# Monetization Setup Checklist

> Manual configuration in **App Store Connect**, **Google Play Console**, and the
> **RevenueCat dashboard**. Nothing on the tiered plans can be sold until every
> step here is done.
>
> **Current as of v9.4.6 (2026-08-26).** FW-89 is done — see
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

**Still blocking a sale**, and none of it is scriptable:

1. **Store products must go live.** Play base plans save as **Draft** and must be
   Activated; ASC subscriptions need US prices and at least Ready to Submit.
   Until then the packages exist but carry no price.
2. **Store credentials** for receipt validation (FW-89 step 4) — without them a
   purchase validates nowhere and no entitlement is ever granted.
3. **Webhook** (FW-89 step 5) — without it the store charges the card and
   `users.subscription_tier` never leaves `free`.

Until all three, the client **fails closed**: a tier whose own SKU resolves to no
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
   description, review screenshot.
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
4. **Grace period 7 days**, account hold left enabled, on all four base plans.
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
4. **Store credentials** for receipt validation:
   - Apple: App Store Connect API key (issuer ID, key ID, `.p8`).
   - Google: Play service account JSON.
5. **Webhook** (Integrations, Webhooks):
   - URL: `https://fwlfiejvxmslkpoojggs.supabase.co/functions/v1/revenuecat-webhook`
     — the **production** project. Anything pointing at `azkmymxdjylmkytrvyfn` is
     the retired legacy project: purchases would validate, users would be charged,
     and no entitlement row would ever land in prod.
   - Auth Header: the `REVENUECAT_WEBHOOK_SECRET` value (below). Mismatch is a 401.
   - Subscribe to **all** event types. `PRODUCT_CHANGE` is what carries tier
     upgrades/downgrades, and `EXPIRATION` / `REFUND` are what drop
     `subscription_tier` back to `free`.
6. **Test event** — RevenueCat's "Send test event", then confirm a row in prod
   `purchase_events` within seconds. Then verify the derived write: `users`
   `subscription_status`, `subscription_tier`, `premium_active_until`.

### Setting the webhook secret

```bash
# from fan-wave-app/, against the PROD project
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<uuid> --project-ref fwlfiejvxmslkpoojggs
```

Paste the identical value into RevenueCat's Webhook Auth Header. Check
`docs/env-swap-runbook.md` if you rotate it — the same secret-vs-dashboard drift
that produced the "ESPN sync 401" class of bug applies here.

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

## Known gap — Android tier upgrade double-bills

`purchaseTier` calls `Purchases.purchasePackage(pkg)` with no
`googleProductChangeInfo` / `oldProductIdentifier` (`lib/entitlements.ts:611`).

On iOS that is fine: all four subscriptions sit in one subscription group with
MVP ranked above Home Team, so the store treats Home Team → MVP as an upgrade
with proration. **Play has no subscription groups.** Four separate subscription
products mean a Home Team subscriber who taps MVP starts a *second* independent
subscription and is charged for both, with no error surfaced anywhere.

Fix is to pass the active purchase as the replacement target on Android before
the upgrade CTA ships on that platform. Until then, treat Android tier upgrade as
unsupported.

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
- [ ] Paywall on a real device shows live prices, not `Unavailable`
- [ ] Displayed price equals charged price on a sandbox purchase of each of the four
- [ ] Home Team to MVP upgrade lands `subscription_tier = 'mvp'` in prod `users`
- [ ] Cancel, then `EXPIRATION`, drops the tier back to `free` and re-gates the UI
- [ ] Restore purchases on a grandfathered `premium_*` account still grants `mvp`
