# Physical iPhone UAT handoff — October 12, 2026

Tester: owner's friend. Current candidate is **TestFlight1.0.0 (37)**, source a60461e, EAS6b9ee448-403d-443f-8b37-99ddbae50231. Apple processing passed and it is available in the existing internal Outside Testers group; tester installation is not yet confirmed. See [candidate identity and evidence](ios-testflight-2026-10-13.md). Do not use the older September16 Build36 for this run.

Before starting, record iPhone model, iOS version, install/distribution method, app version/build, exact EAS build ID/source commit, test date/timezone, backend and telemetry environment. Codex will supply/verify candidate details. Required product source is 57cf4e6 or a later approved commit retaining all its fixes.

Use the full [31-row checklist](../qa/p3.7-ios-device-uat.md). For each row record PASS, FAIL or BLOCKED, observations, evidence location and time. BLOCKED is not PASS. The document's historical build suggestion and production-backend assertions are superseded by actual candidate verification.

Have two ordinary Fan Sphere test accounts and a second device for chat/party checks. For TestFlight, purchases use sandbox and are free during beta testing; a normal Apple Account works, while a separate Sandbox Apple Account is optional for controlled scenarios. The Fan Sphere reviewer account bypasses entitlements and cannot prove purchases. Codex/operator assists with backend row counts, RevenueCat identity, Instruments/proxy measurements, notifications and Sentry. The friend should not be asked to access production secrets or perform database changes. See [Apple's TestFlight guidance](https://beta.itunes.apple.com/).

Run auth/session interruption and reset-link checks, all five tabs, sport changes, capture/playback, uploads/restart/retry, watch parties, chat/reconnect, notifications, purchase/restore and 30-minute mixed use as detailed in the checklist. Row 29 kill-switch testing is operator-controlled on an authorized test backend; never flip the shared production chat flag. If the candidate only points at production, record that row BLOCKED until a safe test candidate or accepted exception is available.

Also record these final-fix regressions on the same candidate:

- Video previews work for query-string URLs and legacy messages lacking media metadata; image previews still work and closing video stops playback.
- Failed/paused upload cards survive app restart and feed refresh; one retry creates one clip, with operator verification.
- Successful posts remove picker copies; export downloads are cleaned; queued original media survives export/restart.
- Populated Discover stays usable during offline refresh and recovers without restarting.
- Repeated Clips filter changes preserve usable feeds and do not cause growing memory use.
- Auth handoff is consumed once; separate group opens create separate presence breadcrumbs without native/JS mirror duplicates; reconnects release old channels. Codex verifies telemetry.

Result record:

| Field | Value |
| --- | --- |
| Tester/date/timezone | |
| iPhone model / iOS | |
| Version / build | |
| EAS ID / source commit | |
| Distribution / backend / telemetry | |
| Checklist rows passed / failed / blocked | |
| Final-fix checks passed / failed / blocked | |
| Screenshots/video/log references | |
| Defects with reproduction steps | |

For a defect, include the row number, exact steps, expected/actual result, timestamp and screenshot/video if useful. Return the filled checklist and this record to the owner/Codex. Current iOS release remains blocked until all required checks pass or the owner explicitly accepts documented exceptions.
