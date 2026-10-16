# Codex / Claude sync — 2026-10-16: delivering the UAT fixes

As last recorded, the 2026-10-14 defect work is written and reviewed but not delivered: nothing
is merged, the backend half is not deployed to hosted staging or production,
and no build carries any of it. The owner asked for this to proceed. Claude
cannot perform the steps below — the Claude Code classifier denies pushes, PR
writes and production access — so they need Codex or the owner.

This note is a status and a hand-off. The authoritative rollout scope stays
[the remediation plan](ios-uat-defect-remediation-2026-10-15.md); nothing here
replaces its gates.

## State

Recorded, with the date each fact was established. The repository cannot
observe hosted state, so anything about deployments or builds is "as recorded",
not "as verified live".

| Thing | State |
| --- | --- |
| Branch | `codex/ios-uat-defects`, 4 commits ahead of the cached `origin/v9.5` |
| Unpushed | `7afc4a6` (SKYC-129) — committed locally 2026-10-15, push denied to Claude |
| PR #21 | open and draft as recorded on 2026-10-15; current state not verifiable from here |
| Migration 109 | verified in an isolated local PostgreSQL cluster (2026-10-15); no hosted staging or production apply recorded |
| `venue-search`, `sync-game-schedules` | source changed and Deno-checked; no deployment recorded, deployed definitions not read |
| Build | newest recorded is iOS 1.0.0 (37), built 2026-10-13 from a source that predates these fixes |
| Gate at `7afc4a6` | `tsc --noEmit` clean; iOS preset 45 suites / 389 tests; Android preset 45 suites / 387 tests |

Jira, read 2026-10-16: **20 In Progress, 2 To Do, 1 Done** of the 23. Done is
SKYC-126 (owner signed up on a real iPhone with iCloud Keychain; no code
shipped). To Do are SKYC-134 and SKYC-138 — no repro, and the program rule is
no speculating. The 20 have code; none has a post-fix device re-test, which is
why none is closed.

## What delivery needs

1. **Push and undraft.** `git push origin codex/ios-uat-defects`, then
   `gh pr ready 21`. `7afc4a6` carries the SKYC-129 fix and two new test
   files; `codex exec` approved it on round 2 and the commit body records that.
2. **Merge PR #21 into `v9.5`** after review. Not `main` — that triggers the
   all-platform build workflow.
3. **Backend, strictly under the existing rollout scope.** Staging first,
   capture each deployed definition and ACL for rollback immediately before
   applying, no ledger replay, no bundled backfill. Migration 109 says in its
   own header that it deploys only after reviewed staging verification. The
   anon-key probes that produced the SKYC-124 and SKYC-125 evidence are a
   regression check, not the verification: they cannot exercise authenticated
   identity, private-roster authorization, RSVP compatibility or the new rate
   limit, and a revoked grant may be refused at the permission layer before
   the function's own "Authentication required" is reached.
4. **SKYC-137 follow-up, as an investigation rather than a fix.** An explicit
   ESPN `timeValid=false` already writes null over a stored timestamp, and
   missing provider data deliberately preserves a known kickoff time. Before
   anyone proposes a backfill, check whether the stored World Series rows are
   actually reached by a sync run.
5. **Build and re-test.** Build from the exact reviewed commit through
   `qa/pre-eas-build-checklist.md`. Every ticket carries its own re-test steps
   in a Jira comment. SKYC-129 also needs an Android pass, because it changed
   shared keyboard handling.

## Corrections to earlier Claude notes

- **SKYC-131 is fixed; the finding in `codex-sync-2026-10-15.md` is stale.**
  `supabase/functions/_shared/venueRanking.ts` now ranks venues whose address
  matches the searched city and state ahead of everything else, with distance
  only as the tiebreak, and `iosUatBackend.test.ts` pins the reported case —
  Prosper venues ahead of nearer Frisco ones, including a "Prosper Rd" in
  Frisco that must not count as a match. Known limitation: the city is only
  recognised with a trailing two-letter state, so "Prosper TX" ranks and
  "Prosper" alone does not.
- The 2026-10-15 note said migration 109 was "applied nowhere". It had been
  executed against a disposable local cluster; what is missing is a hosted
  staging apply.

## Closing policy

Nothing has been closed on written code alone, and the device-acceptance rule
should hold even for the cosmetic tickets: SKYC-133 is a VoiceOver assertion
and SKYC-129 is a tap-target one, neither of which a unit test can establish.
If the owner wants the board to move before a build exists, that is a decision
to record here, not a default.
