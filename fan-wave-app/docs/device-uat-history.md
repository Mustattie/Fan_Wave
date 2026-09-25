# Device UAT history — v9.5 stability program

Physical-device baseline for the v9.5 stability program. **Build 30 is the
most recent physically TESTED Android build.** Build 31 (v9.5.36, e59a65f)
was cut on 2026-09-25 and carries everything after Build 30; it has not been
tested yet. Jest/TypeScript green is not device verification.

Device: Samsung Galaxy S10+ / Android 12, package `org.fansphere.app`,
app version 1.0.0 throughout. Builds are EAS `preview` (staging profile,
prod Supabase). No iOS build has been cut in this program.

## Build timeline

| Build | versionCode | Commit | Tag | Cut from | Physically tested | Findings that produced the next commit |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | 27 | 042814e | v9.5.16 | Phase 1 fixes 1–4 | Yes, S10+ | Java heap 21 MB → 46–54 MB across 4 previews, 60 MB with paywall, 61 MB after background/return, no OOM |
| 28 | 28 | 91fac18 | v9.5.17 | Phase 1 fixes 5–10 | Yes, S10+ | Password-recovery link bounced to the tabs; My Sports change never reached Game Day / Home; realtime `channel_error` warnings on every socket drop; Clips memory question (no incorrect retention found) → fixed in v9.5.18 |
| 29 | 29 | f5207c8 | v9.5.18 | Build 28 UAT fixes | Yes, S10+ | Linked-game party time stayed "Tonight 7PM" (Pirates vs Cardinals 11:35 AM CDT) → fixed in v9.5.19. Sentry: `realtime.rejoin_failed [games-realtime]` |
| 30 | 30 | ae9cded | v9.5.19 | Build 29 UAT fix | Yes, S10+ (`adb shell dumpsys package org.fansphere.app` confirmed versionCode=30) | Stale auto-title after changing the linked game (Lynx vs Fever → Canucks vs Oilers kept the Lynx title while the time moved 7:00 → 8:00 PM) → fixed in v9.5.20, **not yet device-verified** |
| 31 | 31 | e59a65f | v9.5.36 | v9.5.20–v9.5.36 (all post-Build-30 work) | **Built 2026-09-25, NOT YET TESTED.** EAS build d035de6b, APK https://expo.dev/artifacts/eas/37AkR6L5fCZEazBpyrVa8SsveFHVJDkJlK69m_7fLHQ.apk | P3.6 device UAT pending (`qa/p3.6-android-memory-uat.md`); P3.6 stays CODE/AUTOMATION READY until it passes on the S10+ |

## Build 28 coverage (v9.5.15–v9.5.17)

Tested on device:

- Phase 1 fixes 5–10 present for the first time: feed cap, temp-file cleanup, presence single gate, one auth-link consumer, `getLocalUser()` reads.
- Password recovery: **failed** (bounced to tabs).
- My Sports → Game Day / Home: **failed** (tabs stay mounted, mount-only read).
- Realtime: `channel_error` warnings on socket drop (two original causes already fixed in this build; surviving warnings were Phoenix erroring every joined channel).
- Clips memory: investigated, no incorrect retention; forced-GC diagnostic deferred.

## Build 29 coverage (v9.5.18)

Confirmed on device:

- Password recovery: reset link opened Set New Password; new password accepted; returned to Sign In; sign-in with the new password worked.
- My Sports: removing the selected sport cleared its selection state, the Following counter returned to 0, and the sport disappeared from Game Day.
- Offline / reconnect: airplane mode produced the red "No internet connection" banner; after connectivity returned the app recovered in roughly 10 s.
- Sentry: events flowing; identified Realtime issues including `realtime.rejoin_failed [games-realtime]` (addressed later in v9.5.24, unverified).

Found: linked-game party time did not follow the game → v9.5.19.

## Build 30 coverage (v9.5.19)

Confirmed on device (Watch Party UAT):

- Venue search worked.
- Game selection worked.
- Game-relative time controls present; selecting an 8:00 PM game showed "Game time · 8:00 PM", "30 min before", "1 hr before", "Choose date & time".

Regression found: changing the linked game from Minnesota Lynx vs Indiana
Fever to Vancouver Canucks vs Edmonton Oilers moved the time 7:00 → 8:00 PM
but the title stayed "Minnesota Lynx vs Indiana Fever" → fixed in v9.5.20
(7abeaa9), **awaiting device verification**.

## Changes after Build 30 awaiting physical-device verification

None of the following has been in any device build. Each has unit tests
and a clean `tsc`; that is all.

| Commit | Tag | Change | Device check it needs |
| --- | --- | --- | --- |
| 7abeaa9 | v9.5.20 | Auto-title follows the linked game | Re-run the Build 30 Lynx → Canucks scenario; title must change, an edited title must survive |
| 138ee38 | v9.5.21 | Wizard derived-state regression test | none (test only) |
| 6c9fd8d | v9.5.22 | Clips hydration keyed on live ids, poster cache, deduped pages (P2.5/P2.6) | Like tap, upload progress, other-user counter bumps: no refetch storm; no duplicate cards on scroll; poster names stay |
| 4171d4c | v9.5.23 | Upload retry guard, insert-timeout reconciliation, restart reconciliation (P3.5) | Force-quit mid-upload and between PUT and insert: one clip, no orphan, no 409 |
| 3f77b00, 24e763d | v9.5.24 | Jittered reconnects, no per-row Home invalidation, session-gated sockets, chat dedupe, degraded banner (P2.1–3, P3.4) | Background 2 min → return: topics re-subscribe, no `rejoin_failed`; amber "Live updates paused" after 20 s socket loss; chat catch-up shows each message once |
| a7b4d1c | v9.5.25 | Kill switches clips_upload / chat_send / games_realtime / presence (P3.3) | Flip each flag in Studio → background/foreground → gate takes effect; flip back → recovers |
| 813933f | v9.5.26 | Sentry tags + auth/clip events (P3.1) | Events arrive tagged platform/app_version/build_number; `uat.sentry_smoke` on install |
| a126b3a | v9.5.27 | 720p on Clips-tab capture (iOS knob), cached playback source, immutable Cache-Control (P2.10) | Looping clip fetched once; no re-download on A→B→A |
| 1516016 | v9.5.28 | Migrations 102–107 prepared | none until applied |
| 50f46a6 | v9.5.29 | Auth refresh jitter on resume (P2.12); comment authors via get_public_profiles | Return after 1 h backgrounded: no sign-out; comment authors show real names |
| 465a962 | v9.5.30 | Edge functions rewritten | none until deployed |
| 13343a4 | v9.5.31 | k6 suite refresh | none until run |
| 6752df1 | v9.5.32 | Android jest preset config | none (test only) |
| cb7de07 | v9.5.33 | iOS upload-error classification, 720p on chat/Moments capture, banner safe-area inset | Android: banner sits below the status bar under edge-to-edge; chat/Moments capture unchanged on Android |
| ba024fd | v9.5.34 | Jest test pinning the k6 production guard | none (test only) |
| ce9a597 | v9.5.35 | P3.6 memory hygiene: 256 MB video disk-cache cap, buffer options on Moments and chat-preview players, stall-timer cleanup, bounded poster/telemetry maps, tracked reconnect timers, picker copy deleted after upload; explicit iOS usage strings; bottom-sheet insets; CI runs both presets | `qa/p3.6-android-memory-uat.md` rows R1–R8 |

## P3.6 — Android memory / OOM regression testing

**Status: CODE/AUTOMATION READY — DEVICE VERIFICATION REQUIRED.** The final
checklist is `qa/p3.6-android-memory-uat.md`; the iOS counterpart (P3.7,
same status) is `qa/p3.7-ios-device-uat.md`.

Baseline for the next Android regression round is **Build 30 (v9.5.19,
ae9cded)**, not Build 28. The next preview build will carry v9.5.20 through
v9.5.33 at once, so its UAT must cover every row in the table above plus a
re-run of the Build 29 and Build 30 confirmations (recovery link, My Sports,
offline banner, Watch Party time chips and title) to catch regressions in
the realtime and feed rewrites. Run the pre-EAS gate checklist
(`qa/pre-eas-build-checklist.md`) before cutting it.
