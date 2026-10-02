# Codex review and Claude coordination — September 26, 2026

Scope: focused review of the Home games fix, Clips audio/source lifecycle,
and poster memory change. This is not an exhaustive application audit.

## Checkpoint

- Reviewed branch `v9.5`, HEAD `a407e6e`; live remote matched.
- Working tree was clean before this review document was added.
- EAS read-only lookup: latest Android build is 31, from `e59a65f`.
  No Build 32 appeared in the latest-build listing.
- Home fix `15fa69b`, audio fix `8b1ccba`, and poster fix `e737031`
  are committed but absent from Build 31.
- Direct read-only Claude Code consultation was attempted. It returned
  `Credit balance is too low`; no independent Claude findings were received.
  This was a new consultation, not a continuation of the owner's Claude session.

## Findings and proposed scope

Validation: TypeScript completed without errors; both default/iOS and Android
Jest presets reported 24 suites and 193 tests passing. The normal run emitted
a worker teardown warning. A follow-up default run with `--detectOpenHandles`
again passed all tests but remained running after the summary without naming
an open handle; it was interrupted. Test cleanup remains an unresolved issue.

### P1: late Clips loads can resume playback after tab blur/background

In `app/(tabs)/clips.tsx`, the source-load completion calls `applyPlayState`
(approximately lines 728–784), which may call `play()` and explicitly mark
audio foreground-active. The tab-blur cleanup (approximately lines 959–968)
only pauses; it neither invalidates pending loads nor guards their completion
against screen focus. With autoplay already enabled, scrolling to a new clip
and switching tabs before its load resolves permits late playback off-screen.

The AppState background handler only releases when `source.currentUri !== null`
(approximately line 825). A pending first load has a null current URI and
therefore survives the handler. A read-only harness using the actual
SharedVideoSource class reproduced: no release, outcome `loaded`, late
playback still eligible. This demonstrates the control-flow gap, not a
physical-device reproduction of audible background playback.

Proposed fix: gate every asynchronous playback completion on current focus
and AppState; invalidate pending work on blur/inactive/background; handle
pending-only sources on background; preserve paused foreground recovery.
Add integration coverage for deferred loads across those transitions.

### P2: still-live games disappear after four hours

`hooks/useData.ts:119–120` filters both `in` and `scheduled` rows with the
same scheduled-at cutoff. A game still in progress more than four hours
after its scheduled start is removed on a fresh fetch. The previous query
included live rows independently of this cutoff.

Proposed fix: apply the four-hour grace only to scheduled games and retain
live rows regardless of start time. Add a fixture with a five-hour-old live
game and an expired scheduled row; the first must remain, the second must not.

### P2: local-day boundaries are wrong across daylight-saving changes

`lib/homeGames.ts:13–17` adds/subtracts fixed 24-hour durations from local
midnight. A read-only execution of the actual function for November 1, 2026
in America/Chicago produced an end boundary of 23:00 on that same day,
excluding the day's last hour. Spring transitions can include next-day games.

Proposed fix: construct neighboring local calendar midnights, with tests
covering both daylight-saving transitions for Today and Yesterday.

## UAT evidence to preserve

- Sentry delivery was verified on build 26: `uat.sentry_smoke`, staging.
- Earlier background-upload test passed per owner: two full minutes away,
  then automatic recovery after about three seconds without Retry.
- Earlier Home/Game Day score difference converged within seconds and was
  not a confirmed stale-score defect. It is distinct from Build 31's empty
  Home slate regression.
- Build 31 memory gate failed; absence of OOM/ANR does not change that result.
- Disk-only poster caching is a plausible mitigation, not proof that all
  native bitmap retention is eliminated or that the memory gate passes.
- Audio, Home slate, and memory fixes still need device verification on a
  build containing those commits.
- Earlier oversized recording, black preview, subscription gate, and
  interrupted-upload tests need their later resolution/retest records reconciled.

## Next sequence

Review the narrowly scoped findings above before editing application code.
Add regression coverage with each accepted fix, run both Jest presets and
TypeScript, then record the precise commit used for the next UAT build.
Retest on the physical Galaxy S10+; iOS needs separate verification.
No database migration, deployment, subscription change, or production load
test is implied by this review. No application source was edited here.
