# App Review response pack — submission 9cb026fb, drafted 2026-10-27

The owner supplied the rejection from App Store Connect. This is the analysis,
the Resolution Center reply and the replacement App Review Information, ready
to paste once the owner has done the console work each one depends on.

Supersedes the June-era `docs/app-review-resubmission-reply.md` at the
repository root, which is written for build 7 and names an obsolete product
catalogue.

## What Apple actually said

| | |
|---|---|
| Submission ID | `9cb026fb-1ad4-48ce-9d42-e29a9b0bfe16` |
| Submitted | 2026-06-12 02:31 by Thabtech LLC |
| Reviewed | 2026-06-13, iPhone 17 Pro Max |
| Version reviewed | **1.0 (9)** |
| Status | Rejected — 2.1.0 App Completeness, 2.3.10 Accurate Metadata, 5.2.1 Intellectual Property |

There are two Apple messages in the thread, 2026-06-11 and 2026-06-13. The
second opens "The issues we previously identified still need your attention",
so this was already a repeat. The thread has had no reply since.

### Guideline 2.3.10 — Accurate Metadata

> The app or metadata includes information about third-party platforms that
> may not be relevant for App Store users.
> **Next steps:** Revise the app's screenshots to remove non-iOS status bar
> images. Revised screenshots should accurately reflect the app in use on the
> supported devices and highlight the app's main features in the majority of
> the screenshots.

Apple adds a detail worth not missing: *"some screenshots may only be viewed
and updated by selecting 'View All Sizes in Media Manager'"*. Stale Android
captures can be hiding in size slots the main screen does not show, which is a
standard way to get rejected twice for one problem.

### Guideline 5.2.1 — Intellectual Property

> The app includes content that resembles FIFA without the necessary
> authorization.
> **Next steps:** attach documentary evidence and provide your FIFA contact
> information [...] **Alternatively, please remove the third-party content
> from the app and its metadata.**

Take the alternative. The v9 pivot already did most of the work.

### Guideline 2.1(b) — Information Needed

> We cannot locate the In-App Purchases, such as Fan Sphere Premium, Premium
> Annual, Soccer Cup Pass 2026, Soccer Cup Pass 2026, and Fan Sphere Premium -
> Annual, within the app at this time.
> [...] note that the Account Holder must accept the **Paid Apps Agreement**
> in the Business section of App Store Connect before paid In-App Purchases
> will function.

## Root cause of 2.1(b) — present at HEAD, fixed locally, not yet shipped

**Our own reviewer bypass hides every purchase from the reviewer.** Filed as
**SKYC-150**, Highest.

Stated carefully, because three different things are true at once:

- **At `v9.5` HEAD the defect is real** and traced below.
- **An uncommitted fix exists in the working tree**, written by Codex on
  2026-10-27 while this pack was being drafted: `EntitlementState` gains an
  `isReviewer` flag, and `subscription.tsx` derives `canPreviewPlans` from it
  so the Plans block and the Home Team card render for reviewer accounts while
  full feature access is retained. There is a new
  `__tests__/subscriptionReviewAccess.test.tsx`. It is uncommitted, in no
  build, and unverified on a device.
- **The rejection establishes the symptom, not its cause in build 9.** Apple
  reported that the purchases could not be located. That the same app now
  hides them from allow-listed accounts is a strong explanation, not a proof
  about what happened in June — the credentials and the code have both moved
  since.

`lib/entitlements.ts:230` forces reviewer accounts to
`{ tier: 'mvp', hasPremiumAccess: true }`. `app/subscription.tsx` then hides
the "Start Free Trial" button when `hasPremium` is true (line 136) and hides
the entire **Plans** block when `tier === 'mvp'` (line 150). The Soccer Cup
tile went away with the v9.1 sunset. A reviewer signed in as
`fansphere.reviewer@gmail.com` therefore sees nothing purchasable anywhere in
the app — exactly what Apple reported.

The irony is in the code comment at `lib/entitlements.ts:123`, which says the
reviewer's DB status stays `none` precisely "so Apple / Google can see the IAP
funnel when they navigate to Subscription manually". The client override
defeats it.

**Option 1, no reviewer-access code change needed: give App Review a demo
account that is not on the allow-list.** (A build is still required
regardless — see the 5.2.1 content removal.) A normal account resolves to `status: none`, `tier: free`, can
reach the tabs, open Profile → Subscription, choose either tier and reach the
purchase CTA — there is no free-account guard in `purchaseTier`. Migration 070
removed the ordinary creation gates, so navigation is not blocked either.

**Option 2: ship Codex's fix** in the build that is being cut anyway, which
makes the documented reviewer account work as the code comment always intended.

Either way, **this is not proven until the native purchase sheet is seen on
the actual build.** RevenueCat has to initialise and its current offering has
to contain packages matching all four products, or the paywall renders with
purchasing disabled — the same end state Apple complained about. Prices
appearing on the Subscription screen do not establish that; each of the four
sheets needs opening once on the selected iOS build.

The Paid Apps Agreement is a plausible independent cause of the same symptom —
Apple raised it, which is a reason to check it, not evidence that it was the
problem. Owner-only either way.

## Owner checklist before this reply is sent

1. **Accept the Paid Apps Agreement** — appstoreconnect.apple.com/business.
   Same gate that produces `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` on
   `eas submit`.
2. **Create the new demo account** on production with a normal email that is
   *not* `fansphere.reviewer@gmail.com` or `reviewer@fansphere.org`. Sign in
   once, complete onboarding, confirm Profile → Subscription lists both Home
   Team and MVP with real prices, and **open all four purchase sheets** on the
   build being submitted. Seed the account with a followed sport, a group and
   an RSVP so the walkthrough below has something to show. If Codex's reviewer
   fix ships in that build instead, do the same pass with the existing
   reviewer account.
3. **Attach the four current IAPs to the version**: `home_team_monthly_499`,
   `home_team_annual_3499`, `mvp_monthly_1499`, `mvp_annual_9999`. All four
   verified READY_TO_SUBMIT on 2026-10-27.
4. **Withdraw the obsolete products from sale** — the Soccer Cup Pass entries
   Apple named under 5.2.1 are World Cup content in the storefront. Removing
   them answers part of 5.2.1 by itself.
5. **Replace every screenshot** with 6.7" iPhone captures from an iOS
   simulator or device showing the five-tab app, and check **View All Sizes in
   Media Manager** for leftovers. `supportsTablet` is `false`, so confirm
   whether an iPad set is required at all before producing one.
6. **Audit description, subtitle, keywords and promotional text** for World
   Cup and FIFA references.
7. **Select the new build on the version** — it is currently pointing at
   1.0 (9).

## Draft — Resolution Center reply

> Hello App Review,
>
> Thank you for the detail in your June 13 message, and apologies for the long
> gap in replying. We have made substantial changes since build 9 and have
> addressed each of the three issues.
>
> **Guideline 2.1(b) — locating the In-App Purchases**
>
> Reviewing this, we found a problem on our side that would produce exactly
> what you describe. Accounts on our internal reviewer allow-list are granted
> full entitlements, and the app then correctly hides every purchase option
> from them, because there is nothing left to sell that account. We have
> fixed that, and the account supplied in the App Review Information section
> reaches the purchase funnel directly:
>
> Profile tab → Subscription → the Plans section lists Home Team and MVP with
> live prices. Tapping either opens that tier's plan screen, and its call to
> action opens the standard Apple purchase sheet for the monthly or annual
> option.
>
> Our subscription catalogue has also changed since build 9. The products you
> listed — Fan Sphere Premium, Premium Annual and Soccer Cup Pass 2026 — are
> retired. The current products, attached to this version, are Home Team
> Monthly ($4.99), Home Team Annual ($34.99), MVP Monthly ($14.99) and MVP
> Annual ($99.99). The Account Holder has accepted the Paid Apps Agreement.
> We do not apply any storefront or device restrictions to these purchases.
>
> **Guideline 5.2.1 — content resembling FIFA**
>
> We have removed the third-party content rather than seek authorization. The
> app no longer has a World Cup mode or tab; it is a year-round multi-sport
> app covering the NFL, NBA, MLB, college football and others. The Soccer Cup
> Pass products have been withdrawn from sale, and we have audited the app
> and all App Store metadata for FIFA and World Cup references. No FIFA marks,
> logos or trophy imagery appear anywhere in the app or the listing.
>
> **Guideline 2.3.10 — screenshots and third-party platforms**
>
> All screenshots have been recaptured on iOS at 6.7", so every one now shows
> a native iOS status bar, and we checked each size slot in Media Manager for
> older captures. The new set reflects the current five-tab app — Home, Game
> Day, Discover, Clips and Profile — and the majority show its main features
> in use.
>
> Thank you,
> Tatenda Musara — Fan Sphere

## Draft — App Review Information

**Sign-in required:** Yes
**Demo account:** [option 1: a new non-allow-listed account. Option 2, if
Codex's reviewer fix ships in the submitted build: the existing reviewer
account. Pick one and make the reply's wording match.]
**Password:** [insert]

**Notes for reviewer:**

- Fan Sphere is a year-round multi-sport social app — watch parties, fan
  groups, short clips and live scores across the NFL, NBA, MLB, college
  football, MLS and others. It has five tabs: Home, Game Day, Discover, Clips
  and Profile.
- The app is free to use. Subscriptions unlock creator and hosting features
  such as private watch parties and higher clip limits.
  **To see the In-App Purchases:** Profile tab → Subscription. The Plans
  section lists Home Team and MVP with prices; tapping either opens that
  tier's plan screen, whose call to action opens the Apple purchase sheet for
  the monthly or annual option.
- Sports schedule data comes from ESPN's public read-only API. This is
  disclosed in the Privacy Policy, reachable from the Profile tab, and
  involves no contractual relationship.
- Account deletion is available directly from the Profile tab → Delete
  Account.

**Suggested walkthrough:**

1. Sign in with the demo account → Home shows today's games for followed
   sports.
2. **Game Day** → live, upcoming and final states; open a game for detail.
3. **Discover** → search or browse fan groups; open one and read the chat.
4. **Clips** → short video feed; play one.
5. **Watch party** → open one from Home and RSVP (Going / Maybe / Can't Go).
6. **Profile → Subscription** → the two plans and the purchase sheet.

## Qualifications worth keeping straight

- **"A plain account sees the whole app" is too broad.** Public watch-party
  and group creation are free, but **private watch parties remain Home Team
  gated** and free clip posting has a quota. A reviewer on a free account can
  navigate everywhere and will meet those two paywalls — which is fine, and
  arguably helps 2.1(b), but the review notes should not promise unlimited
  access.
- **Onboarding does not present the paywall at all any more.** It finishes at
  the tabs. `choose-plan` still exists, offers Home Team monthly and annual
  with a "Not now" that returns to the tabs, but the onboarding flow no longer
  routes through it. Neither the reply nor the review notes should describe an
  onboarding paywall.
- **The four product IDs are confirmed in code** (`TIER_PRODUCT_IDS`) and
  were READY_TO_SUBMIT in ASC on 2026-10-27. Those are two different facts and
  neither establishes that the live offering serves them to a device.

## What this pack does not cover

The reply is drafted to be true *after* the owner checklist is done. Several
of its sentences are claims about state that does not exist yet — the Paid
Apps Agreement, the attached products, the withdrawn Soccer Cup products, the
recaptured screenshots and the new demo account. **Do not send it before those
are true.** Sending a reply that asserts a fixed state Apple can then disprove
is worse than the delay.

It also does not address the binary: the version is still pointing at 1.0 (9),
and selecting the new build is step 7 of the checklist. Build selection,
parity with Android and the standing public-release NO-GO are covered in
`release-submission-readiness-2026-10-27.md`.
