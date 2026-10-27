# Replacement iOS candidate — TestFlight 1.0.0 (40)

Owner authorised building and uploading this replacement for the friend's iPhone testing
and store screenshot collection on 27 October 2026.

**Available:** Apple processed build 40 as VALID / IN_BETA_TESTING. Verified available
in the existing internal **Outside Testers** group. English What to Test instructions
were attached and read back. No new testers were invited and no external beta review,
App Store review or public release was submitted.

Install **Fan Sphere 1.0.0 (40)** in TestFlight. If an existing tester still sees 39,
refresh/reopen TestFlight and check Previous Builds for 40. An Apple upload alone does
not establish that a tester has installed it; ask the friend to send the TestFlight
build screen before testing.

## Build and verification

- EAS build: `47a5cc06-d1b5-41b9-89fc-970e22f4a1e2`.
- Source: `12497238cf147350593096c065f73a841dc0a909` on `v9.5`.
- Submission: `016a9f43-6714-4390-a847-794f22000e3e`, finished.
- Apple build: `9870c5b8-ccb3-402e-abe9-25629ff15896`.
- Actual cloud builder: `macos-tahoe-26.5-xcode-26.6`, Xcode 26.6 (17F113).
- IPA: 23,648,516 bytes; SHA-256 `dfecb02e9f247ca37427534aca9f801c891355c012fb8b84c127ecdb97b28eca`.
- Identity: `org.fansphere.app`, version 1.0.0 / build 40, minimum iOS 15.1, iPhone device family.
- Distribution profile valid through 31 August 2027; debug disabled; production push entitlement.
- Production Supabase and Sentry configuration present in the compiled bundle; staging backend absent.
- Compiled bundle contains the retired-event notice.
- Product/build inputs unchanged from the tested `ec15fdb` commit; subsequent source commits add documentation only.
  Reused that day's passing TypeScript, 393 iOS tests and 391 Android tests.

This includes the reviewer account's ability to inspect both current plan sheets and
the removal of retired event sales screens. The separate unmerged logo-recycling/stall-telemetry
branch is **not** part of this build. Do not claim all playback/logo issues were fixed.

## Friend's evidence collection

Use the complete forwarded checklist and `store-refresh-2026-10-27.md` / `capture-requirements-2026-10-27.md`.
Start by recording phone model, iOS, build 40, test time and network. Collect seven original native
screens (Home, Discover, Game Day, a licensed practice clip playing, watch-party details, a test group
conversation, Profile) and the four plan-sheet selections before purchases.

Reviewer accounts can inspect both tiers but retain complimentary access. Use a separate ordinary,
non-entitled app account for sandbox purchase, persistence, restore and MVP upgrade acceptance.
Coordinate a second user for chat/RSVP/push checks. Keep test content labelled UAT, use owned footage,
and do not toggle production feature flags.

Physical-device acceptance, native screenshots, actual sandbox purchase/restore, remaining content-rights
decisions and final App Store submission checks are still pending. The original rejected App Store
version has not been resubmitted or switched to this candidate.

Sanitised evidence: `qa/evidence/2026-10-27/testflight/verification.json`.
Private IPA, logs and signing inspection: `C:/fwc/testflight-20261027/`.

TestFlight: https://appstoreconnect.apple.com/apps/6774325670/testflight/ios
