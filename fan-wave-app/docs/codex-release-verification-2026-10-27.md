# Codex verification of Claude's release handoffs — 2026-10-27

Requested by the owner together with publication of the three selected football clips. This is a verification report: the Claude branch has not been merged, no paid build was started, and no store-review submission was performed. Claude's separately authored `release-submission-readiness-2026-10-27.md` is preserved untouched.

## Reviewer clips delivered

All three selected Mixkit items (42558, 42554, 42556) were obtained through their official full-HD download pages, then edited into portrait720x1280 H.264/yuv420p MP4s with fast-start, branded title cards, thumbnails, demo labels and Mixkit credit. Source pages identify the Free License; its visible terms permit commercial projects and distribution. Originals, visible license evidence, prepared files and upload records are private at `C:/fwc/reviewer-clips-20261027`.

Published under the existing Fan Sphere Reviewer profile, with explicit descriptions that these are generic American-football practice demos, not NFL-game footage:

| ID | Title | Duration | Size |
|---|---|---|---|
| 21cafefd-b665-481e-a6f8-249d98557f6d | Under the Lights: Teamwork in Motion | 6.51s | 934592 bytes |
| 84865927-681f-49a2-b6ea-3bb6d0af8f34 | The Perfect Spiral: Passing Practice | 3.17s | 616031 bytes |
| 15212cf5-3d89-4689-b083-88d4d1704416 | Eyes on the Ball: Receiver Drill | 2.84s | 510035 bytes |

All three files decode fully. Authenticated client reads return all three rows, hosted SHA256s match, range requests return206 and thumbnails200. All17 prior rows preserved; total20. No new app build is needed for this content change. This verifies files/network/readability, not a physical iOS/Android player run.

Evidence: `qa/evidence/2026-10-27/reviewer-clips/publication-verification.json` and `reviewer-preview.jpg`.

## What the independent checks confirm

1. Claude branch d997aad is not an ancestor of v9.5. Current TeamBadge still has the bare logoFailed boolean; the branch adds URL-scoped failures/expo-image recyclingKey and clip-stall reporting. A trial merge is conflict-free, preserves Xcode26.6 and has the same executable product/config/test tree as the tested branch. No actual merge done.
2. Fresh branch TypeScript passes; iOS46 suites/395 tests pass. Android first run had one group title render-wait failure; the unchanged focused10 and full46 suites/393 tests then pass. Preserve the initial failure as timing-sensitive verification evidence, not a repaired product defect.
3. QA config sign-in fails in production: HTTP400 invalid_credentials. No password reset/rotation was attempted.
4. Current ASC review-detail credentials authenticate successfully; that new test session was signed out. Server reviewer helpers return isReviewer=true, tier=mvp, hasPremiumAccess=true. Client reviewer bypass matches. The stored free/none subscription fields are intentional under that design; do not blindly apply the legacy2099 grant script. Normal purchase acceptance needs a non-bypass account.
5. Live invoke_team_logo_sync targets production fwlfiejvxmslkpoojggs, not legacy staging. Its Monday09:00UTC cron is active. This answers the routing question, not logo-data correctness or execution success.
6. EAS latest successful iOS is39 from d77e89f; no40 exists in the returned current build inventory. The latest EAS Android artifact is an INTERNAL preview APK35 from2026-10-06, not a production AAB from2026-10-12. It predates PR21.
7. Google Play live API: production versionCode5, alpha6, internal2; beta empty. Uploaded bundles go through6. A temporary edit was used only for reads and discarded without commit. No track/release was changed.
8. ASC live API: version1.0 is REJECTED and currently linked to build9, not39. Its review notes mention World Cup and lack the current five-tab guide. Actual rejection-message text was not exposed by these API reads; requested it from the owner. Repository silence does not establish that nobody has ever read the rejection.
9. All four current Apple subscriptions exist in READY_TO_SUBMIT; all four Google base plans are ACTIVE at the expected US prices ($4.99/month,$34.99/year,$14.99/month,$99.99/year). Apple version attachment, complete metadata, agreements and actual purchase flows remain unverified. Legacy premium products still exist; no deletion or pricing change performed.
10. Sentry14-day queries for build_number39/40 with platform:ios returned no events. This is not evidence that the app has never been launched or that auth is defect-free.
11. Original23 Jira items:17 In Progress,4 Done,2 To Do. Done are126,139,141,144. The assertion that all20 implementation tickets remain In Progress, or nobody has reported physical Build39 use, conflicts with the owner's earlier physical acceptance of139/141/144. That acceptance still does not establish the entire physical checklist.

## Release decision and remaining work

Claude is right that media cleanup/build completion alone does not make the stores ready. Its recommendation to submit39 immediately is a release recommendation, not a verified clearance. Likewise, saying the two extra changes are unnecessary for approval cannot guarantee Apple's decision.

Choose one product source for both platforms: retain39's tested implementation or adopt d997aad and validate its image change on devices. Android needs a current signed AAB; build numbers may differ. One commit/backend is necessary for parity but does not replace native, purchase and device verification.

Before review submission: read/address Apple's actual current feedback; update the version's selected binary, obsolete review notes and appropriate screenshots; confirm IAP attachment and agreements; obtain a working non-bypass QA credential; finish the narrow physical/package/APNs/auth/purchase/playback checks on both platforms. If the branch is included, add badge recycling and stall-diagnostic acceptance. Keep134/138 open until supported by evidence. `supportsTablet:false` is set; the handoff's blanket13-inch iPad screenshot requirement needs checking against the actual supported-device listing rather than assuming a universal app.

Evidence: `qa/evidence/2026-10-27/release-verification/verification.json` and `jira-readback.json`. Jira134/138/149 received new verification comments; no statuses changed. No unrelated production content was removed, no schemas/functions/secrets were changed, no store release occurred.
