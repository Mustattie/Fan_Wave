# UAT closure — 2026-10-06

Claude and Codex are aligned on the remaining release gates. All applicable emulator UAT items are now closed. Recorded Android hardware exceptions remain exceptions, and signed-candidate and physical iPhone verification remain open.

## Reconciled results

| Item | Final result |
| --- | --- |
| Upload kill switch, row 16 | PASS, diagnostic 37: persisted paused upload survives restart and empty Following/Trending refresh; Retry creates one row. Pending uploads are preserved across feed replacement. |
| Chat video previews, R3 | PASS, diagnostic 39: five query-URL videos render; after-close Java 23,784–35,864 KB, settled 25,364 KB; native memory approximately 24–25 MB without a staircase. Media metadata controls rendering. Legacy null metadata retains extension detection, covered by rendered regression tests. |
| Moments feed, R2 | Obsolete on the current release path: no callers of MomentsFeed. The active group feed uses posters and one preview player, covered by R3. No obsolete-feed pass claimed. |
| Watch party, row 11 | PASS: Going appears in detail and Home, server count becomes one; cancellation restores zero. Earlier create/linked-game passes retained. |
| Reconnect, Test 7 | Earlier two-account functional pass retained. Matching presence.rejoined breadcrumb now captured: Sentry fdb8122953db4cbfb93a89fb56ed4793. |
| Presence breadcrumbs, fix 7 | PASS, diagnostic 40: two group opens produce exactly two joined emissions. Sentry scope mirroring duplicates are deduplicated by emission ID without suppressing distinct app calls. Event 0963bb76b46649d9ba1cca8bcfe6b1ad. |
| Auth-link consumption, fix 8 | PASS, diagnostic 40: own staging session cold handoff plus warm replay gives one consumption and two already-claimed callbacks. Event 7bc99e60dcab4100a649df36b37dccc1. |
| Playback loops, row 4 | PASS: 25 native repeat completions on the same cached clip; total app RX increases only 1,890 bytes against a 5,678,912-byte source. Full clip refetch per loop excluded; visual smoothness remains within the recorded hardware exception. |
| Disk cache, R1 | PASS: 150 distinct URL keys over more than 52 minutes in the same process. Native video cache plateaus at 266,908,864 bytes and finishes at 265,206,208, below the 268,435,456-byte cap. Java max 66,968 KB; PSS nonmonotonic. No app OOM, fatal, ANR or cache-write warnings. |
| Channel-count sub-leg, R6 | PASS: ten outage/recovery/open/close cycles over 12 minutes 38 seconds. Each open has four socket channels/three registered topics; every close returns to two/two. Recovered channels subscribed, one subscriber each; heap/PSS do not grow. |
| Discover recovery | PASS: loaded groups and suggestion remain through offline refresh; spinner settles; restored refresh recovers without restarting the app. Expected offline network errors are retained in telemetry. |
| Stable upload cache, fix 6 / R7 | October 5 PASS retained: three posts remove picker copies; original queued media survives export/restart and completes once. Export downloads and test storage assets removed. This was queued-job recovery, not a mid-transfer kill test. |
| Other previous passes | Phase 1, hearts/follows, cross-device party appearance, second-device sign-out, prior soaks and R4/R5/R8 retained. Retained-view fix 0556a5c remains verified at 664 → 664 Views across 50 filter switches. |

R1 uses the same three-second video content with 150 distinct URL keys. The video-cache cap is exact; total application cache also contains metadata/HTTP overhead and finished around 261 MiB. This is not a claim that every application cache directory is limited to 256 MiB.

## Evidence and cleanup

Reviewable exports: [memory samples](../qa/evidence/2026-10-06/cache-memory.csv), [native cache sizes](../qa/evidence/2026-10-06/cache-native.csv), [cached loop counters](../qa/evidence/2026-10-06/cached-loops.csv), [realtime channel counts](../qa/evidence/2026-10-06/realtime-channels.csv), and [build/cleanup manifest](../qa/evidence/2026-10-06/manifest.json). Full diagnostic logs remain locally under C:/fwc.

Readback at 11:06:20 UTC: zero clip fixtures, zero message fixtures, zero party fixtures, zero temporary memberships; original room member count restored to 650; staging clips_upload_enabled=true. Shared source media is retained. Device connectivity was restored and the emulator stopped after completion.

Diagnostic 40 is a local x86_64 release APK using the debug key and the staging backend; native product commit df3824a. Instrumentation remains outside product source. This is not EAS, ARM or physical-device evidence. The subsequent legacy-metadata compatibility change is covered by rendered tests and retains the native playback branch; it still needs signed-candidate smoke.

## Source and validation

Shared v9.5 was safely aligned with origin/v9.5 at 20a6474, then with product commits 6fbba0f (pending upload retention), 3bdc78b (typed previews), df3824a (breadcrumb deduplication), and 7b05aba (legacy preview compatibility). The previous shared state is preserved on codex/shared-pre-uat-20261006. Shared dependencies are present; Claude's earlier dependency setup warning is resolved.

TypeScript passes. Both default iOS and Android Jest presets pass all 35 suites / 302 tests with completed exit code zero using the CI worker configuration. Existing test teardown causes the worker force-exit warning; single-process runs also passed assertions but stayed alive afterward.

## Remaining release gates

1. Production migration 108 application and backend deployment verification. Claude's production attempts were blocked and production was not changed. Stage migration 108 passed review and verification. The historical October 3 drift count is not a current production finding. Operations must verify the other prepared backend changes as well.
2. Signed Android EAS candidate and targeted regression smoke. Carry the retained-view fix and all four new source fixes. The pre-EAS checklist and owner confirmation are still required; no paid build was started. EAS preview uses the production Supabase backend with staging telemetry tags, unlike these diagnostics.
3. Physical iPhone P3.7 before an iOS release: 31 rows still require an actual device and candidate build. iOS unit tests do not close this gate.
4. Launch-capacity acceptance: 300-user campus load passed on Micro; 600-user read/RSVP passed on Small; paired 600-chat/600-socket stress failed (1.8% chat errors, 95% joins). Claude recommends the 300-user launch envelope with a scaling trigger. Owner acceptance is pending; the failed stress test is not relabeled a pass.

No production migration, EAS build, Git push or release was performed in this closure. Emulator UAT is closed; release readiness remains conditional on the four gates above.
