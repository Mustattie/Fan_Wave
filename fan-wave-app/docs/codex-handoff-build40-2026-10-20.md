# Owner instruction — merge the Claude branch and build 40 (2026-10-20)

The owner asked for this directly, after build 39 reached TestFlight. Claude
cannot do either step: merges and paid EAS builds are Codex's lane. This is a
request, not a report.

It supersedes the "hold this for the build after 39" framing Claude used
earlier today. That build is authorized now, before build 39 has been accepted
by anyone.

## What to merge

Branch `claude/logo-recycling-and-clip-stall-telemetry`, single commit
`d997aad`, cut from `v9.5` at `9edecf8` and pushed. Two client changes, both
from the 2026-10-17 investigation:

- **`components/TeamBadge.tsx` (SKYC-138).** Core React Native `<Image>` with
  no key of any kind → expo-image with `recyclingKey={team.logoUrl}`, the same
  guard the Clips feed already applies to its posters. Core `<Image>` holds the
  previously decoded bitmap until a new URI resolves, so a badge instance
  handed a different team can display the old team's logo for the length of the
  fetch. Separately, the `logoFailed` boolean never reset when `team.logoUrl`
  changed — one failed load suppressed the logo for every team that instance
  was later handed — and is now a set of failed URLs so each URL keeps its own
  verdict.
- **`app/(tabs)/clips.tsx` (SKYC-134).** The 15-second stall verdict was the
  only one of three paths to "Couldn't load this video" that reported nothing.
  It now emits `clips.player_stall` with the clip id and a `clip_stall_phase`
  tag of `initial` or `retry`. Telemetry only — playback, the timer lifecycle
  and the failure UI are unchanged. No speculative playback fix.
- `__tests__/teamBadgeRecycling.test.tsx`, 6 tests, pins both badge behaviours.
- Two documentation files, including a Claude hand-off section appended to
  `codex-sync-2026-10-20.md` that lands with the merge. It carries three items
  that are **not** part of this build: the `invoke_team_logo_sync` production
  readback, SKYC-147, and the SKYC-137 row read.

`codex exec` reviewed this branch on 2026-10-20 across three rounds and
approved on round 3. Round 1 found that the failed-URL tracking kept only the
most recent URL; round 2 approved the code and required four documentation
claims be narrowed to what had actually been verified. The commit body records
all of it.

## Requested steps

1. **Merge into `v9.5`.** Not `main` — that triggers the all-platform build
   workflow. The branch content is reviewed, but the merge itself deserves its
   own check: that it applies cleanly against `9edecf8`, and that `d77e89f`'s
   `build.production.ios.image` pin survives untouched.
2. **Re-run the gate on the merge result**, not only on the branch:
   `npx tsc --noEmit`, `npx jest --runInBand`, and
   `npx jest -c jest.android.config.js --runInBand`. On the branch alone these
   were exit 0, 46 suites / 395 tests, and 46 suites / 393 tests.
3. **Build iOS 40 from the exact merge commit** through
   `qa/pre-eas-build-checklist.md`. `cli.appVersionSource` is `remote` and the
   production profile has `autoIncrement: true`, so the build number should
   land on 40 on its own — worth confirming rather than assuming, since a
   silently reused build number is the failure mode that rule exists to stop.

   **Where this note and that checklist disagree, this note wins.** The
   checklist was written for a different shape of release and asks for things
   this instruction excludes: it expects the commit to be on `main`, it
   includes Android artifact steps, and parts of it create watch parties and
   groups and mutate RSVPs against production. For this build the source is
   `v9.5`, execution is iOS-only, and no production mutation is authorized —
   mark those steps inapplicable rather than performing them, and stop on any
   gate you cannot satisfy instead of working around it.
4. **Submit to TestFlight**, same internal Outside Testers group, no new
   testers invited.
5. **What to Test for build 40** = build 39's list, plus the two tickets build
   39 could not cover:
   - **SKYC-138.** Team logos on Game Day cards, especially after switching
     sport filters and scrolling a row away and back. Report the team, the
     wrong logo if any, and whether a cold start shows a flicker on first paint
     before the correct logo lands.
   - **SKYC-134.** Clip playback. The diagnostic detail is whether "Couldn't
     load this video" appears *immediately* or after a ~15-second wait, and
     whether Try again recovers it.

## Not authorized by this instruction

App Store review submission, public release, production data changes or
cleanup, secret rotation, new tester invitations, or an Android build.

## Two things to weigh before spending the build

- **The revised expo-image implementation has no recorded device
  verification.** The change moves five call sites (`GameCard` twice,
  `app/game/[id].tsx` twice, `MvpVoteSheet` once) from core RN `<Image>` to
  expo-image. The unit tests pass, and the round-2 review record checked the
  props against expo-image 3.0.11 as pinned in the lockfile — that transcript
  is not committed, so treat it as a review claim rather than a repository
  fact. Nothing has rendered the new implementation on hardware. Those screens
  are also where several of the other 20 tickets get accepted, so if logos look
  wrong on build 40 this change is the first suspect — and build 39 stays
  installable from TestFlight as the comparison.
- **Superseding build 39 appears to cost a build rather than a test result.**
  The owner's position is that build 39 has not been used yet. Separately, and
  as a Claude read of the Sentry API on 2026-10-20 that this repository cannot
  substantiate: the project had received nothing newer than 2026-10-17, and
  `build_number:39 platform:ios` returned no events. That is weaker than it
  looks — a production launch need not emit anything, since the startup smoke
  event in `lib/errorReporting.ts` is not a production signal — so it is
  consistent with nobody having launched build 39, not proof of it.

## Monitoring note for build 40

Query Sentry with `build_number:40 platform:ios`, not the release string. Per
the same Claude read of the Sentry releases API on 2026-10-20 — again, not
something this repository can substantiate — **both** `org.fansphere.app@1.0.0+39`
and `org.fansphere.app@1.0.0+40` already exist, each created 2026-10-06, well
before either iOS build. They are Android versionCodes: the two platforms share
one build-number sequence in that release string, so a release filter mixes
them. The `platform` term is what separates them.

## Incidental, not a request

The Android sub-profile under `build.production` still carries
`"image": "latest"`. It resolves an Android builder image, not the Xcode
toolchain that failed build 38, so this is not that defect — the shared risk is
the unpinned alias itself, which moves under you between builds. Nothing here
asks for an Android build; the next one inherits that.
