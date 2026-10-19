# Approved UAT rollout — 2026-10-19

Resumed after the owner saved the staging Google Places key. Production rollout and the iOS candidate use the existing explicit approval: build/upload first, then the tester's physical-device acceptance. No App Store review or public release is authorized.

## Backend delivered

- Staging authenticated provider/city-ranking check passed; anonymous access denied; 20 requests allowed through quota and request 21 denied with 429. Temporary staging user deleted.
- Fresh production function definitions, owners/ACLs and deployed function sources captured in `C:/fwc/uat-rollout-20261019` before applying.
- Migration 109 applied to production and security verified. No historical migration replay or manual data backfill/cleanup.
- Production venue-search v6 and sync-game-schedules v17 active, preserving gateway JWT configuration.
- Production anonymous roster/venue/sync probes denied. Authenticated venue search returned 20 venues and roster RPC passed. Only the verification session was signed out.
- Authorized production MLB sync completed with 0 fetch errors (0 upserted, 10 skipped).

## Candidate checks

TypeScript passes. iOS 45 suites/389 tests and Android 45 suites/387 tests pass and exit cleanly. Git product/backend/test diff from reviewed 7afc4a6 is empty. Prior raw working-file hashes differ after checkout line-ending conversion; Git source comparison is clean.

Build source is e76f7055dea46eb87e090f715414e1a16e184ee3 in an isolated managed worktree. The separate untracked 2026-10-17 investigation note is preserved. Production EAS environment has EXPO_PUBLIC_SENTRY_DSN. The source bundle export and TestFlight build/upload status will be recorded below.

No device is attached. This is a candidate for the already-approved tester retest, not evidence that physical acceptance passed. Jira stays open for acceptance; SKYC-134 and SKYC-138 remain investigations and their separate findings are outside this rollout.

Evidence: `qa/evidence/2026-10-19/uat-rollout/verification.json`.

## Build queued

iOS 1.0.0 (38), EAS build `2f6a53ae-a2fe-4259-ba52-f7c70bd03bd1`, is queued from exact source e76f705. The iOS bundle export passed (3925 modules). All 20 implemented issues have rollout/build comments and remain pending acceptance.

Build: https://expo.dev/accounts/dataking263/projects/fan-wave-app/builds/2f6a53ae-a2fe-4259-ba52-f7c70bd03bd1

## STOP: build 38 failed; no Apple upload

Full EAS and Xcode logs confirm that `latest` resolved to `macos-tahoe-26.6-xcode-27.1-sdk-58` (Xcode 27.1). Xcode rejects dependency deployment targets below iOS 15 in RevenueCat, PurchasesHybridCommon, Sentry, SDWebImage, RNSVG and AsyncStorage. Successful build 37 used `macos-tahoe-26.5-xcode-26.6` (Xcode 26.6), confirmed from its build log.

A one-line proposal pins `build.production.ios.image` in eas.json to the exact build-37 image. JSON parses and `git apply --check` passes. The proposed patch is saved in `qa/evidence/2026-10-19/uat-rollout/pin-ios-image-proposed.patch`; it is NOT applied. No dependency upgrade, runtime code change, build retry, TestFlight upload, review submission or public release occurred. Build 37 remains the latest successful candidate. Per the owner's stop-on-failure instruction, request approval for this configuration fix and a paid retry.

All 20 delivery comments were updated to reflect the failed build, correct Expo account URL, production success and remaining device acceptance. No issue was closed. Production changes remain verified; no rollback is indicated by these build-only errors.

Private full logs: `C:/fwc/uat-rollout-20261019/xcode-full.log` and `eas-cloud-0.log`. Expo image configuration reference: https://docs.expo.dev/build-reference/infrastructure/.
