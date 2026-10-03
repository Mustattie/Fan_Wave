# Build 33 UAT run sheet — Phase 1 closure first

Build under test: Android EAS preview, versionCode 33, cut from f131669
(v9.5.41). Carries v9.5.37 (Home Today's Games), v9.5.38 (Clips audio),
v9.5.39 (poster memory), v9.5.40 (Test 6 cache shortcut, Codex-approved)
and v9.5.41 (long-live games, DST day windows, off-screen playback gate,
iOS inactive race). Device: Samsung Galaxy S10+ / Android 12.

Confirm first: `adb shell dumpsys package org.fansphere.app | grep versionCode`
shows 33.

## Part A — Phase 1 gaps (the reason for this build)

| # | Test | Steps | Pass when | Result |
| --- | --- | --- | --- | --- |
| 3 | Kill during upload (physical confirmation of the Build 32 emulator pass) | Record a 20–30 s clip, tap Post; at "Posting… 2–50 %" force-stop from Recents; relaunch | Card returns as queued/retrying, completes under a new path, exactly one clip in the feed; no 409 in Sentry | **PARTIAL** 2026-10-01 — recovery verified: killed at "Posting… 45 %" on mobile data; resumed on relaunch; completed after one Retry on Wi-Fi; one row, new path, no 409 in logcat. Sentry no-409 check pending (owner). 2026-10-02 owner direction: no rerun; the Sentry review is the only open item |
| 5 | Airplane mode during upload | Sign in as an MVP account (free tier caps at 3 clips/24 h); start an upload; airplane mode ON at ~50 %; wait for the failure copy; airplane mode OFF; tap Retry | Friendly copy ("The connection dropped…"), not a raw native string; Retry succeeds; one clip; the New Clip preview rendered (not black) before posting | **PASS** — airplane at 11 % → friendly copy in 4 s; Retry settled in 10 s; one row; preview rendered (free-tier account, 3rd clip of the day) |
| 6 | Live-score navigation, two consecutive updates | Pick a live game. Open it on Home (Today's Games card) and on Game Day. Wait for two consecutive score or clock updates (ESPN sync writes about once a minute per live game). After each update, compare both screens. Optionally repeat with a second device on the other tab | Both screens show update 1 within seconds of each other, then update 2 likewise; Home never sits on a value Game Day has already moved past; Sentry shows no `realtime.rejoin_failed` | **PASS on device, Sentry pending** (2026-10-03 13:38–13:44 CDT, S10+ over adb, Claude; MLB White Sox @ Guardians, prod `games.id 179f9cf7…`, no manual refresh): baseline Bottom 4th 0-2 (server 13:27); update 1 Top 5th — Home 13:38:50, Game Day 13:38:57; both still Top 5th at 13:41:52 / 13:41:58; update 2 Middle 5th — Home 13:42:15, Game Day 13:42:21 (6 s); ten agreeing cycles 13:41:04–13:44:41. Codex independently saw Bottom 6th on both screens at 14:07:43 / 14:08:01 (emulator). Earlier 2026-10-01: one LIVE→FINAL update (Padres–Cubs); 2026-10-02 NHL run cancelled (phone disconnected). Still needed: Sentry `realtime.rejoin_failed` sweep (owner). Log: scratchpad `test6b.log`; `docs/codex-sync-2026-10-03.md` |
| 6b | Live game older than four hours (v9.5.41) | If a game in extra innings or a long delay is available: confirm it still appears on Home and Game Day more than 4 h after its scheduled start | Still listed as live | NOT AVAILABLE — no 4 h+ live game |
| 7 | Two-account chat catch-up | Two accounts in one group chat; device A airplane mode; device B sends two messages; A airplane mode OFF and stays in the conversation | Both messages appear on A within ~10 s, each exactly once | **PASS on device, breadcrumb leg pending** (2026-10-03 14:05 CDT, Codex over computer use; Build 33 on both devices): QA room Anaheim Ducks Fans `cf06ddf9…` with only the two test accounts (the phone account joined through the real deep link). Device A = emulator (fan Sphere Uat) on the chat screen in airplane mode > 30 s; device B = S10+ (Tattie Mus) sent two rows while A was offline (`T7C135gT7D135` — label textually corrupted by the device collision below but one saved row — and `T7E135`, both 14:05); neither visible in the offline snapshot; airplane off at 14:05:53.126; absent at the 9.5 s poll, both present at the 13.9 s poll without leaving the chat (each UIAutomator poll ≈ 4 s, so arrival is bounded to (9.5 s, 13.9 s] against the ~10 s target), each exactly once. Still needed: Sentry `presence.rejoined` breadcrumb evidence. Evidence: `%LOCALAPPDATA%\Temp\fan-sphere-codex-uat-2026-10-03.md`; `docs/codex-sync-2026-10-03.md` |
| 10b | Delete-account sign-out | Delete a throwaway account from Profile | Clean sign-out; no `auth.unexpected_signed_out` | NOT RECORDED — owner attestation as for Test 7; missing datum: build, date, clean return to Sign In, and no `auth.unexpected_signed_out` in Sentry at that time. Needs a throwaway account only if the owner's notes do not hold it |

## Part B — Build 31/32 defects, first physical confirmation

| Check | Steps | Pass when | Result |
| --- | --- | --- | --- |
| Home Today's Games (v9.5.37) | NFL/NBA/WNBA selected → add MLB in My Sports → Game Day → back to Home; then pull-to-refresh | Home shows today's MLB games without a restart; the pull reaches the server | **PASS** — MLB removed: WNBA + NFL only (NFL via the followed Cowboys); MLB re-added: 4 MLB games on Home without restart; refresh picked up the rescheduled Braves time |
| Clips audio (v9.5.38) | Play a clip; tap the speaker toggle twice; relaunch | Sound at media volume; toggle mutes/unmutes and the choice survives relaunch; scroll A→B has no overlap; background stops audio | **PARTIAL** — system evidence only: AudioTrack USAGE_MEDIA in state started while playing; Mute/Unmute toggle persists across force-stop relaunch; no player in background. Audible output not confirmed by ear (owner away) — needs a listening check |
| Off-screen playback gate (v9.5.41) | With autoplay on, scroll to a new clip and immediately switch tabs before it loads; also background the app during a load | No audio or playback starts off-screen; returning shows the clip paused | **PASS** on four attempts, three qualifying — round 2 (swipe to a loading card, Home tab within ~0.3 s: player idle for all 5 s, returned paused), round 3 (swipe to a loading card, HOME key within ~0.3 s — the background-during-load case: no app player for all 5 s, returned paused) and replacement round 4 (2026-10-02 14:31: two full-page swipes so the playing card was fully off-screen, then Home tab; player paused for all 5 s; returned paused). Round 1 inconclusive (the already-playing card stayed on screen). Log: scratchpad `partb_gate.log` |
| DST day window (v9.5.41) | Not testable on this date; covered by unit tests | — | — |

## Part C — P3.6 memory gate (unchanged criteria)

Run `qa/p3.6-android-memory-uat.md` in full: baseline, two 5-minute Clips
stress rounds with `dumpsys meminfo -d` after each sample, the 30-minute
soak, and `am dumpheap` at the first sample over 60 MB Java Heap. Java
Heap < 120 MB at every sample; no OOM/ANR. Then the fixes 5–9 retest list
from `docs/phase1-verification-record.md`, and Sentry filtered to build 33.

## Recording

Enter results in `docs/device-uat-history.md` under a Build 33 entry.
Phase 1 closes when Part A passes; P3.6 closes when Part C passes; Phases
2 and 3 also need the approved backend rollout and the physical iPhone run.

## Run notes — 2026-10-01 00:00–05:35 CDT (adb-driven; Part A/B and the first Part C rows by 01:40, later rows after)

Part C samples (`dumpsys meminfo -d`, Java Heap / Native / TOTAL PSS, MB):

| Point | Java | Native | PSS |
| --- | --- | --- | --- |
| Baseline on Clips | 39 | 100 | 341 |
| First clip playing | 33 | 100 | 335 |
| After 5-min stress | 53 | 126 | 399 |
| After 10-min stress | 53 | 128 | 391 |
| A→B→A + 15 s | 51 | 156 | 434 |
| 5× background/foreground | 35 | 129 | 311 |
| 20 tab switches | 52 | 147 | 370 |
| After two uploads | 94 | 148 | 436 |
| +60 s idle | 89 | 148 | 434 |
| Final idle | 78 | 218 | 490 |

Gate: Java Heap < 120 MB at every sample — met. 0 OOM / ANR. Interim
checkpoint at 01:40: rows 3, 4, 11–17 and the 30-minute soak not yet run
(see "Later rows" below for what was run afterwards). `am dumpheap` is refused on the
preview build ("Process not debuggable"); the hprof step needs a debuggable
build.

Findings: 25 s S10+ default recording = 50.5 MB → "Clip too large" alert
(record ≤12 s here). Inferred cause for the mobile-data failures:
`UPLOAD_TIMEOUT_MS` (90 s, lib/storage.ts) bounds the whole upload; each
attempt died ~90 s after Post at 42–48 % with the "connection dropped"
copy, which the app shows for both timeouts and network errors, so the
attribution rests on the elapsed time, not on a logged error. Retry
restarts from zero. Pre-existing behaviour.

Scripts used: scratchpad `memlib.sh` (tap/dump helpers with a
foreground-window guard), `partc_stress2.sh`, `test3.sh`, `test5.sh`.

Later rows (same night, PC thrashing so the soak segments overran):

| Point | Java | Native | PSS | Views |
| --- | --- | --- | --- | --- |
| Row 3 start (after create-clip flow) | 101 | 195 | 459 | |
| Row 3 after 60 cards | 82 | 187 | 506 | |
| Soak: 35 min Clips | 97 | 242 | 602 | |
| Soak: Clips idle | 87 | 242 | 593 | |
| Soak: background 2 min | 84 | 242 | 503 | |
| Soak: foreground again | 85 | 242 | 540 | |
| Soak: ~1 h Home/Game Day loop | **111** | 107 | 597 | 15,404 |
| After send-trim-memory (explicit GC, 81 MB live / 105) | 88 | 108 | 574 | |
| Cold launch, Home | 36 | | | 271 |
| After 3 rounds of all 5 tabs | | | | 985 |
| After ~6 rounds | | | | 979 |

Row 15 PARTIAL (2026-10-02 15:02–15:14): four record→preview openings,
each New Clip form showing a preview player in state started and each
cancelled without posting. Visible rendering is established for preview 4
only (front camera; the screenshot shows the room); previews 1–3 were
recorded face-down and their frames are black, so player state is the
only evidence for them. On 2026-10-01 with the quota at 3/3 the Post tap
opened the Home Team paywall with the preview player started→paused
behind it. Still needed: two more visibly rendered previews.
Row 3 PARTIAL (15:14–15:16): observed on device — 60 cards with no
duplicate cards, and 40 reading-pace swipes measured by gfxinfo: 1,814
frames, 78 janky (4.3 %), p90 21 ms, p95 23 ms, p99 34 ms. Not observed —
the 200-card cap (MAX_LOADED_CLIPS) is unreachable with the 20 clips in
prod, so the cap is covered by `__tests__/clipsFeed.test.ts` only; row 3
stays PARTIAL unless an explicit unit-evidence exception is recorded. Row 14 PARTIAL:
substituted soak (35 min Clips, then ~1 h Home/Game Day) with no chat
segment and no five-minute cadence; samples are the ones listed above.
Row 4 (2026-10-02 14:17–14:21): the same clip looped for 4 min with the
player continuously started and 0 bytes received per netstats across
60 s — PARTIAL. Redo 14:58–15:00 on the 11 s `Build33_T5_airplane` clip:
player state started at every 10 s sample across 120 s, which supports
an ESTIMATED ≈11 loops; loop completion and the absence of buffering
between samples were not directly observed; 0 bytes received. "No
stutter" is not visually verified (adb cannot judge it; gfxinfo counts UI
frames, not SurfaceView video frames) — needs a human glance. Row 13 PARTIAL (14:18): red "No internet connection" within 3 s of
airplane mode, still shown at 32 s, cleared within 15 s of reconnect; no
amber "Live updates paused" banner appeared. Not verified: live scores
resuming (no live game), the Wi-Fi→LTE leg, and Sentry
`realtime.rejoin_failed`. Gate held (max Java 111 MB) but the Java
trend across the session is upward and the Home/Game Day loop produced
the session high. The 15,404 live Views vs 271 cold and ~985 (flat) across
repeated tab rounds show navigation alone does not explain the count; that
the remainder is the loaded Clips feed is inferred, not measured. Rows 11,
16, 17 not run (11 writes to prod watch parties, 16 needs a prod flag
change, 17 needs the Sentry login). Row 12 PASS 2026-10-03 (Codex, emulator,
QA room Anaheim Ducks Fans): five labelled messages `R12M1`–`R12M5` plus a
nonpersonal emulator-camera photo, background 14:15:19.919 → 14:17:21.099
(121.2 s), resumed into the same chat, every message once, photo bubble
kept, presence `2 online`, logcat clean of fatal/ANR/OOM/"cannot add
presence callbacks"; PSS 244,736 → 214,114 KB, Java 51,536 → 30,264 KB,
Native 51,376 → 32,340 KB. Evidence: `r12-*.xml/png`, `r12-mem-before/after.txt`
in `%LOCALAPPDATA%\Temp`; `docs/codex-sync-2026-10-03.md`.

Sentry (2026-10-02 16:57, owner in the dashboard): Build 33 events arrive
in project react-native, environment staging (smoke event
`uat.sentry_smoke` 3 h before the check, device SM-G975U, Android 12).
Finding — runtime evidence: the custom `build_number` tag from
`lib/errorReporting.ts` `buildTags()` is ABSENT on the Build 33 event
while `app_version` from the same function is present. Code conclusion
(from reading the installed modules, not observed at runtime): expo-constants
18.0.14 no longer provides `Constants.nativeBuildVersion`, so `buildTags()`
coalesces it to null and the P3.1 "split issues by build number" tag never
attaches. The SDK's own `dist` (33) and `release` ("1.0.0 (33)") do carry
the build, so the sweep uses `dist:33`. Fix candidate (separate reviewed
commit, not a Build 33 blocker): read `nativeBuildVersion` from
`expo-application` (7.0.8 is installed transitively via expo-notifications;
it must be declared in package.json) and validate the value against the
EAS remote build number in the next build.

2026-10-02 17:10: the owner disconnected the phone before the 17:30 CDT
NHL game. Test 6 (two consecutive updates) and row 13's scores-resume leg
were not run; both remain PARTIAL. 2026-10-03 03:40: phone still not
attached (`adb devices` empty); no device work this session.

## 2026-10-03 session — shared devices (Claude over adb + Codex over computer use)

The owner plugged the S10+ back in (13:26 CDT) with the Fan_Sphere_UAT
emulator also running Build 33, signed in as a second account (fan Sphere
Uat). Claude and Codex agreed the run order first (Sync 4 in
`docs/codex-sync-2026-10-03.md`). Claude ran Test 6 (above). From ~13:45 the
Codex desktop session drove both devices itself (Test 7, fix 5, row 12,
smoke); Claude's tab-bar taps landed on the open keyboard during the
hand-over and corrupted two Test 7 labels (`T7B_13471 5pm`, `T7C135gT7D135`)
— recorded in the sync doc; Claude made no device input after 14:05.
Prod writes this session. In the QA room only: one join (Tattie Mus →
Anaheim Ducks Fans), nine labelled messages, one emulator photo; Build 33
has no leave-group UI, so the membership and messages remain. Outside
the room, on the emulator account (fix 5): one like on the first visible
clip and one follow of its creator, both reversed afterwards (baseline
`Follow` / count 0 confirmed); the like/follow notifications, if any,
were not recalled.

New finding (Codex): after the phone joined, the emulator — already a
member, on the group screen — kept `1 member · 2 online` through a
deep-link reopen and the row-12 background/return. Cause (code): the
fan-group screen reads `chat_rooms.member_count` once on mount, bumps it
only on its own Join, and `chat_room_members` is not in the realtime
publication. Fix v9.5.43 (`lib/groupMemberCount.ts`): refetch the count on a
presence-roster change, on navigation re-focus and on app foreground; Codex
reviewed. Not device-verified until the next build.

Build 34 static gates on origin/v9.5 639c2ae (v9.5.42 + v9.5.43 on top of
Build 33's f131669), run 2026-10-03 14:45 in an isolated worktree:
`npx tsc --noEmit` clean, Jest 217/217 on both presets, `npx expo-doctor`
18/18, `npx expo install --check` up to date. The one new silent catch
(`lib/groupMemberCount.ts` returns null when the count cannot be read) is
intentional: the refresh is best-effort. No new inserts/updates/deletes.

Still open after this session: rows 11 (Create Party link/change/cancel),
13 (both network legs + scores-resume), 14 (exact 30-min soak), 15 (two more
rendered previews), 16, 17, R1–R8, R4, R5; Sentry legs of Tests 3/6/7 and row
13; Clips listening check; Test 10b; fixes 6/7/8/9 evidence; cross-device
party.
