# Device UAT history — v9.5 stability program

Physical-device baseline for the v9.5 stability program. **Build 30 is the
most recent physically TESTED Android build.** Build 31 (v9.5.36, e59a65f)
was cut on 2026-09-25 and carries everything after Build 30. Its P3.6 UAT
found a Home "Today's Games" regression (fixed in v9.5.37, awaiting Build
32); P3.6 is NOT PASS. Jest/TypeScript green is not device verification.

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
| 31 | 31 | e59a65f | v9.5.36 | v9.5.20–v9.5.36 (all post-Build-30 work) | Yes, S10+ (versionCode 31 confirmed). Memory baseline on Home fine: Java Heap 12,524 KB, Native Heap 31,252 KB, TOTAL PSS 136,586 KB, TOTAL RSS 246,176 KB | **FAIL — Home "Today's Games"**: with NFL/NBA/WNBA selected Home showed "No games on deck today"; adding MLB in My Sports updated Game Day (MLB under Upcoming) but Home stayed empty, also after pull-to-refresh → fixed in v9.5.37 (15fa69b), **not yet device-verified**. P3.6 NOT PASS; the rest of the checklist was not run on this build |
| 33 | 33 | f131669 | v9.5.41 | v9.5.37–v9.5.41: Home Today's Games, Clips audio, poster memory, Test 6 cache shortcut (Codex-approved), long-live games + DST windows + off-screen playback gate + iOS inactive race (Codex-approved) | Yes, S10+ (versionCode 33 confirmed 2026-10-01 00:00 CDT; driven over adb by Claude with the owner away from the screen). EAS 5e78ef42, APK https://expo.dev/artifacts/eas/fM-LwT4sUFZP6anpx729fHtcivQiGoy4sKSgG6yjiwA.apk | **Phase 1 — Test 3 PARTIAL** (recovery verified on device; the Sentry no-409 check is pending): force-stopped at "Posting… 45 %" (mobile data); relaunch resumed the job by itself, two LTE attempts then died at ~45 % as "connection dropped" (suspected 90 s whole-upload timeout, see findings), one Retry on Wi-Fi completed; exactly one row `Build33_T3_kill`, new storage path, no 409 in logcat; Sentry not yet checked. **Test 5 PASS**: airplane mode at 11 % → "The connection dropped before this finished. Tap Retry when you have signal." within 4 s; Retry after reconnect settled in 10 s; one row `Build33_T5_airplane`; New Clip preview rendered a frame (dark lens, not the black placeholder). **Test 6 PARTIAL**: Padres–Cubs LIVE 4-1 Top 9th was identical on Home and Game Day for 4 cycles, then the LIVE→FINAL update left both screens inside the same 30 s cycle and the final landed in Home/Yesterday after local midnight; only one update was available tonight, the second consecutive update needs a daytime game. 6b: no 4 h+ live game. **Tests 7 and 10b NOT RUN** (need a second device / a throwaway account). **Part B** (Home PASS; audio and off-screen gate PARTIAL): Home Today's Games follows My Sports without a restart (NFL on Home comes from the followed Cowboys via get_user_teams, by design); Clips audio PARTIAL — system evidence only (an AudioTrack USAGE_MEDIA in state started while a clip plays, Mute/Unmute toggles and the muted choice survives a force-stop relaunch), audible output not confirmed by ear; off-screen gate PARTIAL — no player started in any of 3 rounds (2 tab-switch, 1 background); the paused-return criterion held in rounds 2 and 3, round 1 is inconclusive because the swipe left the already-playing card on screen and it resumed. **Part C gate held on the rows run** (Java Heap / Native / PSS, MB): baseline on Clips 39/100/341; first clip 33/100/335; 5-min stress 53/126/399; 10-min stress 53/128/391 (Build 31: 121/301/657); A-B-A 51/156/434; 5× bg/fg 35/129/311; 20 tab switches 52/147/370; after the two uploads 94/148/436 → 89/148/434 at +60 s; final idle 78/218/490. 0 OOM / 0 ANR in logcat. Later the same night: row 3 PARTIAL (60 cards, no duplicates, 101→82 MB; smoothness and the feed cap not verified); row 15 PARTIAL (one preview, not three; with the quota at 3/3 the Post tap opened the Home Team paywall and the preview player went started→paused behind it); row 14 PARTIAL — a substituted soak, 35 min Clips-only then ~1 h of Home/Game Day looping, no chat segment, no five-minute cadence (the PC was thrashing, so segments overran): Java 97 → 87 (idle) → 84 (background 2 min) → 85 → **111 MB** after the Home/Game Day hour (session high, under the 120 MB gate), PSS 602 → 593 → 503 → 540 → 597; an explicit GC via send-trim-memory took Java to 88 MB (81 MB live of 105). Live Views were 15,404 at that point vs 271 at cold launch and ~985 with all five tabs mounted (flat across repeated tab rounds), so navigation alone does not explain the count; the loaded Clips feed as the source is inferred, not measured. 2026-10-02: row 4 PASS (same clip looped 4 min, 0 bytes received over 60 s), row 13 PARTIAL (red offline banner in 3 s, cleared within 15 s of reconnect, no amber banner; scores resuming, the Wi-Fi→LTE leg and the Sentry `realtime.rejoin_failed` check not done). Rows 11, 12, 16, 17 NOT RUN. `am dumpheap` is refused ("Process not debuggable") on the preview build, so the >60 MB hprof step cannot be met without a debuggable build. **Findings**: (1) a 25 s clip from the S10+ default camera is 50.5 MB → "Clip too large — please trim under 25 MB" with Re-record / Pick another / Cancel (good copy; record ≤12 s on this phone); (2) inferred: `UPLOAD_TIMEOUT_MS` = 90 s in lib/storage.ts bounds the whole upload; on a ~110 KB/s mobile link each 22 MB attempt died ~90 s after Post at 42–48 % with the "connection dropped" copy, which the app uses for both timeouts and network errors, so the attribution rests on the elapsed time; Retry restarts from zero; pre-existing, not a Build 33 regression, worth a resumable or progress-based timeout ticket. Evidence: `qa/build33-uat-runsheet.md` Run notes. |
| 32 | 32 | 9e3128f | docs on v9.5.39 | v9.5.37 Home Today's Games, v9.5.38 Clips audio, v9.5.39 poster memory (no Test 6 fix) | Emulator only (installed 2026-09-26, versionCode 32 confirmed) | **Test 3 kill during upload: PASS on emulator** (force-stopped at "Posting… 2 %", upload recovered after relaunch, exactly one clip); physical confirmation still needed. **Test 5 incomplete**: a 29 s / 18 MB clip uploaded and rendered, but the airplane-mode failure → Retry sequence was not finished. Cannot close Test 6 (fix is v9.5.40). No physical S10+ run. |

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

## Build 31 coverage (v9.5.36) — FAILED

Physical P3.6 UAT started 2026-09-25 on the S10+ (versionCode 31 confirmed).

- Install: OK. Home memory baseline: Java Heap 12,524 KB, Native Heap
  31,252 KB, TOTAL PSS 136,586 KB, TOTAL RSS 246,176 KB (within gate).
- **Home → Today's Games: FAIL.** Selected sports NFL, NBA, WNBA → "No games
  on deck today — check back tomorrow!". Added MLB in My Sports → Game Day
  correctly listed MLB under Upcoming Games → back on Home: still the
  empty state, also after a manual pull-to-refresh.
- Root cause (verified against prod read-only at 09:31 UTC: 0 live, exactly
  30 finals in the 24 h window, 887 future scheduled): `useGames` ran one
  query ordered `status asc` ('in' < 'post' < 'scheduled') with a single
  limit. Home's limit 30 returned only yesterday's 30 finals, its local-day
  cut dropped them all, and the 30 s AsyncStorage shortcut made
  pull-to-refresh return the same rows. Game Day's limit 50 got 20
  scheduled rows on top, hence MLB. Not a My Sports propagation bug: the
  interest set reached both tabs; Home simply had no rows for today.
- Fix v9.5.37 (15fa69b): two independently bounded legs (live+scheduled
  earliest-first, finals most-recent-first) merged client-side; manual
  refresh clears the storage cache for every limit; Home's day/interest
  selection extracted to `lib/homeGames.ts` and covered by
  `__tests__/homeTodaysGames.test.tsx`, which rebuilds the prod dataset.
- **Clips audio: DEFECT (discovered/confirmed during Build 31 physical
  testing).** Clips play video but no audio; multiple clips tested; device
  media audio works outside the app. The tester retrospectively recalls
  the same on Build 30. Git history proves it predates Build 31: the shared
  feed player has been created `muted = true` since 284eda4 (v8.7+ bundle,
  2026-06-23) and no code path ever unmuted it, so every build since has
  played clips silently on both platforms. Uploaded clips do carry an AAC
  (`mp4a`) track (two recent public clips probed). Fixed in v9.5.38
  (8b1ccba): the flag is owned by `lib/clipAudio.ts` (active card audible
  while foregrounded and not user-muted; background silences before the
  release; preference persisted), with a speaker toggle on the active
  card. Only the active card has a player, so off-screen cards are silent
  by construction. **Not device-verified.**
- **Clips memory gate: FAIL** (controlled stress test, separate from the
  audio defect). Playback stayed functional: no OutOfMemoryError, FATAL
  EXCEPTION or ANR in logcat; Fan Sphere GC lines only ("Explicit
  concurrent copying GC freed ~15 MB, heap ~96 MB / 120 MB"). Sample 5
  crossed the P3.6 gate (Java Heap < 120 MB at every sample) and idle
  reclaimed little.

| Sample | Java Heap | Native Heap | TOTAL PSS | TOTAL RSS | Swap PSS |
| --- | --- | --- | --- | --- | --- |
| 1. Home baseline | 12,524 KB | 31,252 KB | 136,586 KB | 246,176 KB | |
| 2. Initial Clips playback | 39,060 KB | 113,120 KB | 335,725 KB | 438,748 KB | |
| 3. After stress round 1 (~5 min, ~15–20 clips) | 65,784 KB | 232,620 KB | 538,664 KB | 627,324 KB | 16,487 KB |
| 4. After 2–3 min idle | 74,732 KB | 232,628 KB | 543,368 KB | 632,416 KB | 16,595 KB |
| 5. After stress round 2 (~5 min, ~15–20 more clips) | **123,484 KB** | 308,376 KB | 672,578 KB | 760,572 KB | 17,719 KB |
| 6. After 5 min idle, no scrolling | 117,860 KB | 303,512 KB | 661,688 KB | 750,044 KB | 17,720 KB |

  Trend: Java 12 → 38 → 64 → 73 → 121 → 115 MB; Native 31 → 111 → 227 →
  227 → 301 → 296 MB; PSS 133 → 328 → 526 → 531 → 657 → 646 MB.

  Root-cause analysis (source + native module review, no heap dump yet):
  the Phase 1 ExoPlayer byte cap IS applied on Android (expo-video's
  vendored DefaultLoadControl uses the 8 MB override on every prepare and
  resets the allocator on stop), so ExoPlayer's Java sample pool is not the
  96 MB live set; per-card VideoViews are unregistered on destroy. The one
  retention provable from source: every card poster is decoded to the
  1440x3040 viewport (~17.5 MB, native heap) and `cachePolicy="memory-disk"`
  kept decoded posters in Glide's in-memory LRU after their cards
  unmounted. Fixed in v9.5.39 (e737031): posters are disk-cached only, keyed
  by clip for Fabric recycling. Verdict: a combination -- expected native
  buffering (decoder, surface, 8 MB sample pool, Hermes heap) plus
  excessive poster retention; a Java-heap leak is neither confirmed nor
  excluded, so Build 32's run captures an hprof at the first sample over
  60 MB (steps in `qa/p3.6-android-memory-uat.md`). **Not device-verified;
  the gate is unchanged.**
- Remaining checklist rows were not run on Build 31; Build 32 restarts
  the P3.6 checklist from step 0.

## Changes after Build 30 awaiting physical-device verification

None of the following has been in any device build. Each has unit tests
and a clean `tsc`; that is all.

| Commit | Tag | Change | Device check it needs |
| --- | --- | --- | --- |
| 10cd73b | v9.5.40 | Games hook consults the 30 s storage cache only on cold start (Phase 1 Test 6); Codex-approved 2026-09-27 | Build 33: live game open on Home and Game Day, two consecutive score updates land on both within seconds |
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
| e737031 | v9.5.39 | Clips posters disk-cached only + recyclingKey (Build 31 memory gate) | Build 32: repeat the two 5-min stress rounds with the six samples; Java Heap < 120 MB at every sample; hprof at the first sample over 60 MB |
| 8b1ccba | v9.5.38 | Clips audio: shared feed player unmuted under a policy module; mute toggle on the active card; background silences first | Build 32: active clip has sound, speaker toggle mutes/unmutes and persists, scrolling A→B has no overlap, background stops audio, return comes back paused |
| 15fa69b | v9.5.37 | Home Today's Games: two-leg games query, refresh bypasses the storage cache, selector extracted + regression test | Build 32: repeat the Build 31 scenario (NFL/NBA/WNBA → add MLB → Home shows today's MLB games; pull-to-refresh reaches the server) |
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
