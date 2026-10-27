# Store submission readiness — iOS and Android, 2026-10-27

The owner wants to submit for review now, time is short, and both platforms
must ship the same thing. This is the coverage list for that, written before
any paid build so nothing is discovered after one.

Claude's lane produced it; Codex reviewed it and corrected five factual errors
in the first draft (recorded at the end). Claude cannot merge, build, submit or
edit store listings — every execution item belongs to Codex or the owner.

## The thing to understand first: the binary is not the bottleneck

A build is a merge, a gate run and a paid build away. The App Store side is
further away than that, and no build shortens it:

1. **The build 11 rejection has no recorded response.** iOS 1.0.0 (11) was
   submitted 2026-06-12 and rejected on or before 2026-06-17. The response was
   deliberately deferred until the binary worked, and this repository records
   no reply and no statement of what Apple cited. Repository silence is not
   proof the owner never read it — but if there is an unanswered Resolution
   Center thread, resubmitting walks into the same guideline. Someone has to
   open App Store Connect and look. This is the highest-value fifteen minutes
   available right now, and it is owner-only.
2. **The listing probably still describes the pre-pivot app.** The June review
   notes walk the reviewer through a "World Cup" tab. The app now has five
   tabs — Home, Discover, Game Day, Clips, Profile — and no World Cup tab. A
   reviewer following those notes lands somewhere that does not exist, which
   is how 2.1(a) "could not complete" findings get written. Codex has since
   confirmed this against the live ASC API: the version's review notes do
   still mention World Cup and carry no five-tab guide, and the version is
   linked to build 9. What the API reads did **not** expose is the rejection
   message text itself, so that part still needs eyes on the console.
3. **The In-App Purchase product IDs in the old checklist are obsolete.** The
   repository-root `docs/app-review-resubmission-reply.md` tells the operator
   to attach `premium_monthly_999`, `premium_annual_10788` and `wc_pass_2026`.
   The app now sells four different products (below). The legacy IDs are still
   recognised in code for existing-subscriber compatibility, so this is not a
   dead file — but following its attachment instructions risks repeating the
   Guideline 2.1(b) rejection that killed build 6.

Items 1-3 are owner-owned, independent of which binary ships, and can start
immediately in parallel with everything else here.

## The tension the owner needs to resolve: parity versus speed

These two instructions pull against each other, so the choice has to be
explicit.

Build 39 is already on TestFlight — VALID, IN_BETA_TESTING, built from
`d77e89f` on a verified Xcode 26.6 toolchain, and the only iOS build that
carries all twenty UAT fixes (build 37 predates the PR 21 merge `5f9dcf1` of
2026-10-16). Submitting it costs no build time.

But **Android cannot match it.** The newest Android artifact on record is
build 35 — an *internal preview APK* from commit `57cf4e6`, completed
2026-10-06, which also predates the PR 21 merge and carries none of the twenty
fixes. There is no production Android artifact on record at all. And the
Android build cannot safely run until `build.production.android.image` is
pinned, which is itself a commit. So an Android build can never share build
39's exact SHA.

**Recommended path — parity without the unverified refactor:**

1. Pin `build.production.android.image` on top of current `v9.5` head. One
   reviewed line. Do **not** merge `d997aad`.
2. Build iOS and Android from that single commit. Whatever build numbers EAS
   assigns are whatever it assigns; do not plan around a particular one.
3. The iOS artifact then carries **unchanged product source** relative to the
   verified build 39 — current HEAD differs from `d77e89f` only in
   documentation and QA evidence, and the pinned Android image key does not
   configure the iOS binary. That is a claim about source, conditional on
   verifying the build inputs are equivalent too: remote EAS environment
   values, lockfile, credentials and resolved config. The build number differs
   by definition.
4. "Twin" here means the two artifacts share a source commit. It does not mean
   their runtime behaviour has been shown to match — see the `Platform.OS`
   caveat below.
5. **Accept the signed artifacts before submitting**, per Gate A item 6.
   Neither binary has been seen at this point in the sequence.

This satisfies "exactly the same" honestly, keeps the badge/telemetry change
(`d997aad`) out of a release nobody has hardware-verified, and costs one extra
iOS build. The badge and telemetry work then ships as the next update, which
needs a **marketing version bump** in `app.json` — most likely to `1.0.1`,
since auto-increment moves only the build number and leaves the version at
`1.0.0`. Its build number will be assigned when it is built and has nothing to
do with the number the parity build happens to receive.

**If speed beats parity:** submit iOS 39 today as-is and let Android follow
from the pinned commit, accepting a documented config-only source delta and a
staggered release. Faster by one build cycle; the two stores are briefly out of
step. Still conditional on Gate B and the release-hold decision below.

**If the owner wants `d997aad` in the release anyway** — reasonable if shipping
a known-open logo defect is unacceptable — then merge it first and the build
39 / build 40 A/B on two iPhones stops being optional, because an expo-image
regression on Game Day would be visible to the reviewer.

## The standing release hold, and the decision it forces

`docs/production-readiness-2026-10-06.md` records **public release status:
NO-GO**, pending capacity correction and revalidation, final device results,
release artifact checks and rollout approval. `release-resumption-2026-10-12.md`
repeats it. That hold has never been lifted in the record.

Submitting for review is not the same act as releasing, and the two stores
differ in how cleanly they separate them:

- **App Store Connect: reliable.** Choose "Manually release this version" and
  an approved build sits in Pending Developer Release until you release it.
- **Google Play: conditional.** Managed publishing can hold an approved
  update, but eligibility has to be confirmed and the setting has to be
  **enabled before submitting** — and Google excludes first-time app
  publishing from it, which is one more reason the Play console state needs
  checking rather than assuming. A **staged rollout is not a substitute**: it
  is public distribution to a percentage of users, and it applies only to
  updates. If managed publishing turns out not to be available, hold the Play
  production submission and use an internal or closed testing track instead,
  documented as the alternative.

**Submitting while holding the release switch starts the review clock — which
is the thing the owner is short of — without going public.** If the clock is
the constraint, this is the move, with the Play caveat above.

What it needs is an explicit decision rather than silence, and it is the
owner's alone. One of:

- **Hold the launch.** Submit for review with manual release, keep the NO-GO
  in force, and lift it separately once capacity revalidation and the device
  results land. Recommended, and it costs nothing in time.
- **Accept the risk.** Lift the NO-GO deliberately, documented as an
  authorised risk acceptance naming what is unvalidated — principally
  concurrent Realtime behaviour at scale, where the load harness itself is
  known to over-report success.

Every "submit" instruction in this document is conditional on that decision
and on the Gate B items. Nothing here authorises a public rollout.

## "Exactly the same on both platforms" — what that can and cannot mean

**Achievable, and worth requiring:**

- **One source commit** for both binaries, recorded in both build records so
  parity is provable rather than asserted.
- **One backend** — both already target production `fwlfiejvxmslkpoojggs` with
  migration 109 applied, so schema and RPC behaviour are identical.
- **One version name** — `1.0.0` in `app.json`, shared.
- **One env block** — the `production` profile's `env` is shared; it carries
  both RevenueCat keys and the runtime selects by platform. The *remote* EAS
  production environment values still need verifying against it.

**Not achievable, and not worth chasing:**

- **Build numbers.** `appVersionSource` is `remote` with `autoIncrement`, and
  EAS counts per platform. iOS is at 39; Android's last recorded artifact is
  35. Forcing them level risks a reused number — the exact failure that rule
  exists to prevent. Users see `1.0.0`.
- **Toolchain images, signing, store listings and approval timing.**
  "Submitted together" is achievable; "approved together" is not something
  either store lets you control.

**And one caveat on what a shared commit buys.** There are no
`.ios.`/`.android.` file splits under `app/`, `components/` or `lib/`, but
there are **42 `Platform.OS` occurrences, 36 of them direct comparisons**, and
they are not all cosmetic — `lib/androidReplacement.ts` implements substantive
Android-only subscription-replacement behaviour. A common commit establishes
source parity. It does not establish equivalent runtime behaviour, and the
subscription paths in particular have to be exercised on both platforms.

## Gate A — source and build (Codex)

1. **Pin `build.production.android.image`** to a known-good Android image, as
   its own reviewed one-line change. It is still `"latest"` — the same moving
   alias that destroyed iOS build 38 when it resolved to Xcode 27.1 overnight.
   It has not bitten Android only because no Android build has run since.
2. **Merge `d997aad`** only if the owner chooses that path; verify the iOS
   image pin survives.
3. **Gates on the exact build commit:** `npx tsc --noEmit`,
   `npx jest --runInBand`, `npx jest -c jest.android.config.js --runInBand`.
   Expect 45 suites / 389 tests iOS and 45 / 387 Android without `d997aad`;
   46 / 395 and 46 / 393 with it.
4. **Pre-paid-build checks, before spending anything:** resolved Expo config;
   the pinned Android image actually exists and is available; lockfile and
   dependency health; the real EAS production environment values and telemetry
   configuration; signing credentials present (iOS signs from the gitignored
   `credentials/` directory); and the current remote build counters for both
   platforms.
5. **Build both platforms from the one commit**, recording the SHA in both.
6. **Verify both artifacts.** iOS: identity, profile, production push
   entitlement, production backend URL and a usable Sentry DSN in the bundle.
   Android: package `org.fansphere.app`, versionName `1.0.0`, signature check,
   and the **upload certificate** compared against what Play expects —
   distinct from Play's own app-signing certificate. A mismatch is a hard stop
   worth catching before upload, though not necessarily unrecoverable.
7. **Confirm the assigned build numbers** rather than assuming them.

## Gate B — App Store Connect (owner, Claude drafts)

Each of these is a guideline Apple has already cited against this app.

- [ ] **Read the build 11 rejection** and tell me what it says. I will draft
      the Resolution Center reply as the build 7 reply was drafted.
- [ ] **Sign any outstanding agreements** at appstoreconnect.apple.com/business.
      An expired agreement surfaces as a 403
      `REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` on `eas submit`, after the build
      is already paid for.
- [ ] **Attach the four current IAP products to the version**, not the three
      from the June checklist: `home_team_monthly_499`,
      `home_team_annual_3499`, `mvp_monthly_1499`, `mvp_annual_9999`
      (`lib/entitlements.ts:562`). Each must be "Ready to Submit" **and**
      ticked in the version-binding section. Decide separately whether
      `wc_pass_2026` stays on sale — the code still honours a `wc_pass`
      entitlement, so withdrawing it is a product decision, not a cleanup.
- [ ] **Verify the purchase stack, not just the attachment.** RevenueCat
      offerings and package-to-product mappings, Play base plans, entitlement
      delivery, purchase, restore and subscription-change on both platforms.
      Attaching IAPs proves none of this.
- [ ] ~~**Re-grant the reviewer entitlement**~~ — **superseded by Codex's live
      verification, do not do this.** The ASC review-detail credentials
      authenticate today, and the server reviewer helpers already return
      `isReviewer=true`, `tier=mvp`, `hasPremiumAccess=true`, with the client
      bypass matching. The stored free/none subscription fields are
      intentional under that design, so running the legacy 2099 grant script
      would fight it. What is still needed is a **non-bypass account** for
      purchase acceptance, since the reviewer account cannot exercise a real
      purchase path. The QA credential beside it is confirmed stale —
      production returns HTTP 400 `invalid_credentials` (SKYC-149).
- [ ] **Recapture screenshots from an iOS simulator or device**, 6.7" iPhone,
      native iOS status bar, showing the current five-tab app. `supportsTablet`
      is `false`, so an iPad set is probably not required — confirm against
      what ASC actually asks for rather than against the June checklist, which
      assumed iPad. Never upload from `screenshots/`; that is Android Maestro
      output and its status bar alone is a 2.3.10 rejection.
- [ ] **Rewrite the App Review notes** for the five-tab app. I can draft them
      from the current tab structure on request.
- [ ] **Audit description, subtitle and keywords for "FIFA".** Verified clean
      in tracked source today — case-insensitive search across `app/`,
      `components/`, `lib/`, `i18n/` and `assets/` returns nothing — but ASC
      metadata is not in this repository, and text baked into screenshot images
      is not covered by a source grep.
- [ ] Export compliance: encryption exempt, as confirmed on build 39.

## Gate C — Google Play (owner, Codex executes)

- [ ] A production AAB from the same commit, signature-verified.
- [ ] Confirm what is actually live in the Play console before uploading. The
      ledger has v4 live with v5/v6 pending from June; the new versionCode must
      exceed whatever is really there.
- [ ] If the launch is being held, confirm managed publishing is both eligible
      and **enabled before** the submission — treat that ordering as the
      operational rule here, so the hold is never racing the review. If it is
      unavailable, do not submit to the production track; use internal or
      closed testing and record why.
- [ ] Data safety form and target API level still current.
- [ ] Play's products match the four iOS ones in price and availability, or the
      two platforms are not selling the same thing despite running the same
      code.

## Ownership

| Lane | Items |
|---|---|
| **Owner only** | Build 11 rejection, agreements, screenshots, listing metadata, IAP attachment, Play console state, and the parity-versus-speed decision |
| **Codex** | Android image pin, optional merge, gates, pre-build checks, both paid builds, artifact verification, TestFlight upload, `eas submit`, SKYC-149 |
| **Claude** | This list, Resolution Center reply draft, App Review notes draft, Jira, release notes — no production access |

## Honest risks in submitting now

- **Physical acceptance is incomplete, not absent.** The tester physically
  accepted SKYC-139, 141 and 144 (owner-relayed, no device model or capture
  recorded), and those three are closed. Seventeen remain In Progress: code
  complete, verified on 2026-10-22 against a local Release build on the
  simulator plus the live backend, not against the TestFlight artifact. The
  six-item physical list on the report's last page has not been worked
  through, and it covers install, Keychain, APNs and cross-device — the things
  a reviewer hits in the first minute.
- **SKYC-134 and SKYC-138 remain open investigations**, neither with a
  confirmed reproduction on build 39. Shipping with them open is a normal
  release decision, but it is a decision.
- **Android's first build from this source is also its first UAT of it.**
- **Realtime capacity at scale is unvalidated and explicitly stopped.**
  `docs/production-execution-2026-10-12.md` records a load-harness defect where
  `runSocket` reports `joinedAll=true` after a system error, so the join metric
  can overstate reliability; the 300-user Realtime leg needs revalidation and
  the instruction is not to claim a capacity pass until the accounting is
  fixed. Reviewers do not load-test, so this is unlikely to affect the review
  outcome — but it is a named condition of the standing NO-GO, so it is not
  discharged by observing that. It needs the decision above: hold the launch,
  or accept the risk in writing.

## Live store and backend state, verified by Codex on 2026-10-27

Codex ran independent live API reads the same day, recorded in
`codex-release-verification-2026-10-27.md` and
`qa/evidence/2026-10-27/release-verification/`. These replace several
assumptions above with facts, and one of them is worse than this document
assumed.

**The App Store version is in a rejected state with the wrong binary attached.**
ASC version `1.0` reads REJECTED and is currently linked to **build 9** — not
39. Its review notes still mention World Cup and carry no five-tab guide. So
the submission path is not "attach and send": the version needs its selected
binary changed, its notes rewritten, and Apple's current feedback addressed.
The rejection message text was not exposed by the API reads, which is why
reading it in the console remains a Gate B item — and, correctly, repository
silence never established that nobody had read it.

**The purchase catalogue is in better shape than feared.** All four Apple
subscriptions exist in READY_TO_SUBMIT; all four Google base plans are ACTIVE
at the expected US prices — $4.99/month and $34.99/year for Home Team,
$14.99/month and $99.99/year for MVP. Legacy premium products still exist and
were not touched. What remains unverified is *attachment to the version*,
complete metadata, agreements and the actual purchase flows.

**Google Play live state:** production versionCode **5**, alpha 6, internal 2,
beta empty. The next upload must exceed 6, not 5.

**Build inventory confirms the parity gap.** Latest successful iOS is 39 from
`d77e89f`, and no build 40 appeared in the returned EAS inventory. The newest
Android artifact is the internal
preview APK 35 from 2026-10-06, predating PR 21 — exactly as described above.

**A trial merge of `d997aad` is conflict-free**, preserves the Xcode 26.6 pin,
and produces the same executable product, config and test tree as the tested
branch. Fresh gates: TypeScript clean, iOS 46 suites / 395 tests. The Android
run hit one timing-sensitive group-title render-wait failure on first attempt
and passed on re-run at 46 suites / 393 tests — preserved as verification
evidence, not treated as a repaired defect.

**`invoke_team_logo_sync` is answered, and the answer is good.** It targets
production `fwlfiejvxmslkpoojggs`, not the legacy project, and its Monday
09:00 UTC cron is active. The open question from the 2026-10-20 hand-off is
closed on routing; logo-data correctness and execution success are separate
and still unexamined.

**Sentry** returned no events for `build_number:39` or `40` with
`platform:ios` across 14 days — which, as previously noted, is not evidence
the app was never launched.

**Reviewer feed content.** Codex published three licensed Mixkit clips under
the Fan Sphere Reviewer profile, described as generic American-football
practice demos rather than game footage, replacing the dark QA clips removed
yesterday. The **three new clips** decode fully with matching hosted hashes,
range requests returning 206 and thumbnails 200; the 17 prior rows were
preserved, for 20 in total, and were not themselves re-tested. That verifies
files, network and readability — **not** playback on a physical iOS or
Android device. No app build is needed for the content change.

**Jira readback:** of the original 23 items, 17 In Progress, 4 Done
(SKYC-126, 139, 141, 144) and 2 To Do (SKYC-134, 138).

## Review record

Codex reviewed the first draft on 2026-10-27 and returned CHANGES REQUESTED,
correcting all of the following, each verified independently before this
rewrite:

1. Android build 35 was described as a production artifact built 2026-10-12.
   It is an internal **preview** APK from commit `57cf4e6`, completed
   2026-10-06; 2026-10-12 was its download and signature-verification date.
2. "Builds 37-39 carry all twenty fixes" was wrong — build 37 also predates the
   PR 21 merge. Only build 39 does.
3. "Nobody has launched build 39 on a physical iPhone" and "the twenty tickets
   are still In Progress" contradicted the owner-attested acceptance that
   closed three of them.
4. The parity claim understated the platform split: 42 `Platform.OS`
   occurrences, 36 direct comparisons, including substantive Android
   subscription-replacement logic — source parity is not runtime parity.
5. Gate A promised both "same SHA as build 39" and "pin the Android image",
   which cannot both hold since pinning creates a commit. Resolved above by
   building both platforms from one pinned commit.

Codex also supplied the pre-paid-build checklist in Gate A item 4, the
upload-versus-app-signing certificate distinction, the purchase-stack
verification item, and the `supportsTablet: false` point that removes the
assumed iPad screenshot requirement. It agreed build 39's source is the
lower-change candidate while disputing "submit now" as unconditional, on the
grounds that the rejection details, purchase configuration and remaining
artifact acceptance all still need checking.

A second review pass returned CHANGES REQUESTED again on three points, all
applied: the parity build was being given build 40's name and the next
update's role at the same time, when EAS assigns those numbers and the
marketing-version bump belongs to the later update; the artifact-equivalence
claim was too strong and is now an unchanged-product-source claim conditional
on verifying build inputs, with signed-artifact acceptance required before
submission; and the capacity STOP was described without being resolved, when
the standing public-release NO-GO needs an explicit owner decision. That
decision now has its own section, and every submit instruction is conditional
on it.
