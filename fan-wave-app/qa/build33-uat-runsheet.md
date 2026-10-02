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
| 3 | Kill during upload (physical confirmation of the Build 32 emulator pass) | Record a 20–30 s clip, tap Post; at "Posting… 2–50 %" force-stop from Recents; relaunch | Card returns as queued/retrying, completes under a new path, exactly one clip in the feed; no 409 in Sentry | **PARTIAL** 2026-10-01 — recovery verified: killed at "Posting… 45 %" on mobile data; resumed on relaunch; completed after one Retry on Wi-Fi; one row, new path, no 409 in logcat. Sentry no-409 check pending (owner) |
| 5 | Airplane mode during upload | Sign in as an MVP account (free tier caps at 3 clips/24 h); start an upload; airplane mode ON at ~50 %; wait for the failure copy; airplane mode OFF; tap Retry | Friendly copy ("The connection dropped…"), not a raw native string; Retry succeeds; one clip; the New Clip preview rendered (not black) before posting | **PASS** — airplane at 11 % → friendly copy in 4 s; Retry settled in 10 s; one row; preview rendered (free-tier account, 3rd clip of the day) |
| 6 | Live-score navigation, two consecutive updates | Pick a live game. Open it on Home (Today's Games card) and on Game Day. Wait for two consecutive score or clock updates (ESPN sync writes about once a minute per live game). After each update, compare both screens. Optionally repeat with a second device on the other tab | Both screens show update 1 within seconds of each other, then update 2 likewise; Home never sits on a value Game Day has already moved past; Sentry shows no `realtime.rejoin_failed` | **PARTIAL** — one update (LIVE→FINAL) seen, both screens moved in the same 30 s cycle; second consecutive update needs a live game |
| 6b | Live game older than four hours (v9.5.41) | If a game in extra innings or a long delay is available: confirm it still appears on Home and Game Day more than 4 h after its scheduled start | Still listed as live | NOT AVAILABLE — no 4 h+ live game |
| 7 | Two-account chat catch-up | Two accounts in one group chat; device A airplane mode; device B sends two messages; A airplane mode OFF and stays in the conversation | Both messages appear on A within ~10 s, each exactly once | NOT RUN — needs a second device |
| 10b | Delete-account sign-out | Delete a throwaway account from Profile | Clean sign-out; no `auth.unexpected_signed_out` | NOT RUN — needs a throwaway account |

## Part B — Build 31/32 defects, first physical confirmation

| Check | Steps | Pass when | Result |
| --- | --- | --- | --- |
| Home Today's Games (v9.5.37) | NFL/NBA/WNBA selected → add MLB in My Sports → Game Day → back to Home; then pull-to-refresh | Home shows today's MLB games without a restart; the pull reaches the server | **PASS** — MLB removed: WNBA + NFL only (NFL via the followed Cowboys); MLB re-added: 4 MLB games on Home without restart; refresh picked up the rescheduled Braves time |
| Clips audio (v9.5.38) | Play a clip; tap the speaker toggle twice; relaunch | Sound at media volume; toggle mutes/unmutes and the choice survives relaunch; scroll A→B has no overlap; background stops audio | **PARTIAL** — system evidence only: AudioTrack USAGE_MEDIA in state started while playing; Mute/Unmute toggle persists across force-stop relaunch; no player in background. Audible output not confirmed by ear (owner away) — needs a listening check |
| Off-screen playback gate (v9.5.41) | With autoplay on, scroll to a new clip and immediately switch tabs before it loads; also background the app during a load | No audio or playback starts off-screen; returning shows the clip paused | **PARTIAL** — no app player started in any of 3 rounds (2 tab-switch, 1 background); paused-return held in rounds 2 and 3; round 1 inconclusive (the swipe left the already-playing card on screen and it resumed). A replacement round on a fresh card is still needed |
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

Row 15 PARTIAL: one preview (not three) rendered; quota 3/3 → Post Clip
opened the Home Team paywall and the preview player went started→paused
and stayed paused. Row 3 PARTIAL: 60 cards, no duplicate cards; scrolling
smoothness and the 200-card feed cap were not verified. Row 14 PARTIAL:
substituted soak (35 min Clips, then ~1 h Home/Game Day) with no chat
segment and no five-minute cadence; samples are the ones listed above.
Row 4 PASS (2026-10-02 14:17–14:21): the same clip looped for 4 min with
the player continuously started and 0 bytes received per netstats across
60 s. Row 13 PARTIAL (14:18): red "No internet connection" within 3 s of
airplane mode, still shown at 32 s, cleared within 15 s of reconnect; no
amber "Live updates paused" banner appeared. Not verified: live scores
resuming (no live game), the Wi-Fi→LTE leg, and Sentry
`realtime.rejoin_failed`. Gate held (max Java 111 MB) but the Java
trend across the session is upward and the Home/Game Day loop produced
the session high. The 15,404 live Views vs 271 cold and ~985 (flat) across
repeated tab rounds show navigation alone does not explain the count; that
the remainder is the loaded Clips feed is inferred, not measured. Rows 11,
12, 16, 17 not run (11/12 write to prod watch parties / a real group chat,
16 needs a prod flag change, 17 needs the Sentry login).
