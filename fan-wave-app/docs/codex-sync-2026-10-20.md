# Xcode image fix and TestFlight retry — 2026-10-20

The owner explicitly approved applying the prepared Xcode 26.6 image fix, retrying the paid build and uploading the successful candidate to TestFlight.

- Applied only `build.production.ios.image`: `latest` → `macos-tahoe-26.5-xcode-26.6`.
- Commit `d77e89f11c9d986ba731a21b27a72fb0f7198f79` pushed to v9.5 and remote hash verified.
- JSON parse, exact before/after object comparison and Git whitespace checks passed. No runtime source or dependency changes, so the passing 389 iOS / 387 Android tests from October 19 remain the product-code gate.
- Reused the clean isolated managed build checkout; left the separate untracked October 17 investigation note untouched.
- Build 39: `b2dd9155-31c6-4b1d-b231-28f78e8842f8`, source d77e89f. The builder log confirms `macos-tahoe-26.5-xcode-26.6`, Xcode 26.6 (17F113).

Build: https://expo.dev/accounts/dataking263/projects/fan-wave-app/builds/b2dd9155-31c6-4b1d-b231-28f78e8842f8

The prior backend rollout remains recorded in `qa/evidence/2026-10-19/uat-rollout/verification.json`. No additional backend change is part of this retry. The earlier build 38 failed and was never uploaded to Apple.

Build completion, artifact checks and Apple processing/group availability will be recorded below. Physical-device acceptance is pending; no App Store review submission or public release is authorized.

## Completed

Build39 finished successfully and IPA identity/profile/production push entitlement checks passed. Bundle contains the production backend URL and a usable production Sentry DSN. SHA256: `9e16b6c1f9b09ec939e102f622f67c3d71691392c1c963f8caea07ad0959f6b0`.

EAS submission `230a0be7-0174-4249-be19-45b5e7981e99` succeeded. Apple build `e51bb27e-6377-48ef-bdfa-405d5d8a0526` is VALID and IN_BETA_TESTING, with encryption exempt. Verified available in the existing internal Outside Testers group; targeted English What to Test notes attached. No new testers invited, beta review submission, App Store review submission or public release.

All20 implementation issues received TestFlight delivery comments; no issue closed. Physical-device retest remains the next acceptance gate. SKYC-134/138 investigations remain outside the implemented fixes. Evidence: `qa/evidence/2026-10-20/testflight/verification.json`.

TestFlight: https://appstoreconnect.apple.com/apps/6774325670/testflight/ios
