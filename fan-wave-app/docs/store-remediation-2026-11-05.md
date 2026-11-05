# Store preparation — 2026-11-05

This status supersedes the historical build status in the October 27 response pack. Do not send its draft response without reconciling these remaining checks.

## Completed

- App Store draft now has six untouched physical iPhone screenshots from build 40: Home, Game Day, watch party, link a game, create watch party and Profile. All are 1206 × 2622 RGB originals. Apple reported COMPLETE for all six. The previous three-image set was removed after verifying local backups.
- Superseded local screenshot sets, including World Cup imagery, were moved into `play-store-screenshots/archive/2026-11-05-pre-pivot`. Active iPhone assets and checksums are in `play-store-screenshots/current/ios/manifest.json`.
- Subscription cancellation copy now names the current platform's store. This source change is not included in iOS build 40.
- Android production build image is pinned to the Expo SDK 54 NDK r27b image.

## Payment review notes

Sign in with the designated review account, then open Profile → Subscription. Select See Home Team or See MVP, choose Monthly or Annual, then use the purchase button. Restore Purchases and Manage in App Store / Google Play are on the Subscription screen. Current products are `home_team_monthly_499`, `home_team_annual_3499`, `mvp_monthly_1499` and `mvp_annual_9999`. Game Day does not require a separate tournament pass.

The reviewer account has a feature-access override. Use an ordinary account to verify actual purchase entitlements, persistence after relaunch and restore. The supplied iPhone evidence shows the Home Team annual sandbox sheet and purchase success; it does not establish every plan or post-relaunch entitlement state. Do not claim those checks are complete.

## Still required

- Claude's concurrent cleanup record (`qa/evidence/2026-11-05/play-listing/cleanup-20261105.json`) records removal of 16 obsolete Play screenshots and replacement of tournament descriptions with interim copy. Two onboarding screenshots remain; tablet sets are empty. Release tracks were unchanged. Public propagation is not established. Current authenticated Android captures are still needed; do not advertise new subscriptions against the old production release.
- Build and validate a current Android production AAB, including target SDK, signing, merged permissions and native library alignment. Existing production version code 5 and preview APK 35 are not the replacement candidate.
- Verify Play Console App Content, Data safety, app access, policy status and release controls in an authenticated Console session.
- Verify native purchase flows and restored entitlements on both platforms.
- Confirm content and logo rights. The initial management-token attempt failed before mutation. Subsequently, the existing review account signed in successfully; its ownership of all three generic practice demos was verified, their `sport_id` changed from `nfl` to null through RLS, and all three changes were verified by readback. No other clip fields changed.
- Reconcile Apple's complete review conversation and current subscription attachments before resubmission.

No review submission or public release was performed during this preparation.
