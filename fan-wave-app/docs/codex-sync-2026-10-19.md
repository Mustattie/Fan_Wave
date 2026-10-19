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
