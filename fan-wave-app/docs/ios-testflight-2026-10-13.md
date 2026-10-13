# iOS TestFlight candidate — October 13, 2026

Status: **1.0.0 (37) uploaded, Apple processing VALID, internal state IN_BETA_TESTING. Physical iPhone UAT remains open.** Owner explicitly authorized building and uploading for the friend's UAT, with no App Store review submission or public release.

| Identity | Value |
| --- | --- |
| Source | v9.5, a60461ecda3cd2c9d1fbf6a8ef1eb5433989ad62 |
| Product baseline | 57cf4e6; later delta is documentation/QA only, no app/config/dependency change |
| EAS build | 6b9ee448-403d-443f-8b37-99ddbae50231 |
| EAS profile | production, iOS only, store distribution, local signing, remote version auto-increment |
| Bundle / app version / build | org.fansphere.app / 1.0.0 / 37 |
| EAS completion | October13, 06:23:34 UTC |
| EAS upload job | 03f4b5d5-ba04-4dba-b7e6-7bacab34455e |
| App Store Connect build | 4a36e2f3-fc82-40d5-b80e-b968cd684ed1 |
| Uploaded | October13, 06:27:08 UTC / 01:27:08 America/Chicago |
| Backend / telemetry | Production Supabase and production Sentry tags |
| TestFlight group | Outside Testers, existing INTERNAL group with access to all builds; build37 listed; two existing testers |
| Download requirements | Physical iPhone, iOS15.1 or later, TestFlight access through the existing internal group |
| SHA-256 | 45fad71a8799fababdabea2b0d3c452ca68ae59925f65479d712ff0d4607fe72 |

Open [TestFlight in App Store Connect](https://appstoreconnect.apple.com/apps/6774325670/testflight/ios). Build status/evidence is saved under qa/evidence/2026-10-13/testflight. The private IPA remains at C:/fwc/testflight-20261013/FanSphere-1.0.0-37.ipa.

## Gate and coordination

At the exact candidate source, TypeScript passed, the default iOS preset passed35 suites/302 tests, and Expo Doctor passed18/18 before queueing. The Android preset also passed35/302 while the cloud build was running; its earlier same-product-source pass was retained at queue time. Existing Jest worker teardown warning remains; assertions pass. No source or dependency changes were made for this build. The published source commit and clean branch were verified; main was not pushed, avoiding its automatic all-platform build workflow.

This is beta UAT authorization, not a full-release GO. Earlier emulator closure and live backend checks are retained; actual iPhone rows, Android signed-candidate checks, corrected capacity testing, production store-artifact checks and public rollout remain separate. Claude reviewed the beta prerequisites read-only, confirmed local store-signing configuration, and distinguished the historical Android gate at57cf4e6 from this iOS archive. Codex was the sole build/upload operator.

The local distribution certificate and App Store profile match Apple teamD887TLA6L9 and org.fansphere.app, expire August31,2027, and use store distribution rather than device-restricted signing. IPA inspection confirmed iPhoneOS/build37, matching profileUUID c614586e-b832-4d4a-80bd-ef3131a1813e, production push entitlement, beta-reports-active and usesNonExemptEncryption=false. Apple processing VALID supplies the server-side archive acceptance; local inspection is not a claim that Windows performed codesign verification.

The EAS production environment contains a usable public Sentry DSN. No EAS update channels are configured. Packaged Expo.plist has runtime1.0.0, checkOnLaunch=NEVER and no request channel header; candidate identity remains recorded by the archive/source. The initial CLI emitted a runtime-policy warning; the completed IPA contains the runtime settings above.

## TestFlight access and push setup

Apple reports this build IN_BETA_TESTING in the existing internal Outside Testers group. The group has automatic access to all builds; a redundant manual association was rejected and was not needed. Subsequent group-build listing includes37, and the build's included group readback confirms Outside Testers. Two existing testers are present. The owner's friend's membership has not been identified; no new tester invitation or App Store Connect user was created. If the friend is not already a member, the owner must arrange appropriate internal access. No external public link was enabled.

APNs inspection initially found no push key associated with this bundle. The same Expo account already held key9986279943 for the correct Apple team. Codex linked that existing key to this app and verified the association; no key was generated, rotated or revoked, and no private key was printed. This is a service credential association, not an IPA rebuild. Actual notification receipt/deep-link behaviour remains P3.7 row26.

English tester notes were attached to this build's TestFlight localization. No App Store version was attached (ASC relationship data=null), no Beta App Review submission exists (data=null), and no App Store review/public release was requested. TestFlight internal testing is the approved route.

## Friend handoff

Install **Fan Sphere1.0.0 (37)** in TestFlight and use [the updated handoff](iphone-uat-handoff-2026-10-12.md) plus [all31 P3.7 checks](../qa/p3.7-ios-device-uat.md). Record phone model/iOS/build/time and PASS/FAIL/BLOCKED with evidence. Tester installation and results are not yet recorded.

TestFlight purchases run in sandbox and are free during beta testing; a normal Apple Account can be used, with a separate Sandbox Apple Account optional for controlled scenarios. See [Apple's TestFlight guidance](https://beta.itunes.apple.com/) and [sandbox testing documentation](https://developer.apple.com/documentation/StoreKit/testing-in-app-purchases-with-sandbox). Use an ordinary Fan Sphere test account, not the reviewer entitlement bypass.

This candidate points at production: label new test content UAT, retain the existing no-manual-cleanup rule, never toggle global production kill switches, and record row29 BLOCKED pending safe test-backend evidence or owner acceptance. Do not interpret legitimate tier/rate-limit messages as defects: free users have3 clips/24h,20 RSVP inserts/day,10 party creations/day; chat is60/min. Plan repeated flows within those limits. Backend/RevenueCat/telemetry/measurement legs requiring operator help should be marked BLOCKED until assisted, not guessed PASS.
