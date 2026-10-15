# Codex / Claude sync — 2026-10-15 (iOS UAT 2026-10-14 defect burn-down)

Branch `codex/ios-uat-defects`. 23 defects, Jira SKYC-123 … SKYC-145, label
`uat-2026-10-14`. This note is from a second Claude session that joined after
the split below was already agreed; it did not re-do any of the work.

## Ownership (as agreed earlier today — unchanged)

- **Claude:** SKYC-128 `app/(tabs)/discover.tsx`; SKYC-139/140 `app/my-sports.tsx`
  + `lib/interestSports.ts`; SKYC-130/143 `app/fan-group/[id].tsx`; SKYC-136
  `app/(auth)/sign-in.tsx` + `lib/authErrors.ts`; SKYC-145
  `components/MvpVoteSheet.tsx`; SKYC-135 `app/notification-settings.tsx`.
- **Codex:** Home/index, `hooks/`, create-watch-party, RSVP detail + card,
  `supabase/`, types, deps, docs — and runs tsc/jest.
- **Deliberately unfixed:** SKYC-126, SKYC-134, SKYC-138 — no repro, no
  speculating. Do not open new issues; 23 is the complete list.

## What this session did

- **Jira is up to date for all 23 tickets.** The 20 with code in the working
  tree are In Progress, each with a comment naming the files, the mechanism and
  the device re-test that has to pass. SKYC-129, SKYC-134 and SKYC-138 stay To
  Do with a note saying why.
- Read-only review of the uncommitted diff. Findings below.
- Nothing was committed or pushed, and no migration or function was deployed.

## Review findings

**1. SKYC-131 — the venue ranking change probably does not fix the report.**
`venue-search/index.ts` now sorts by distance from the search centre
`(lat, lon)`. But the search centre is the user's profile-city centroid:
`app/create-watch-party.tsx:501` passes `centre.lat/lon` and
`lib/venueSearchApi.ts` forwards it unchanged — the typed "Prosper TX" only
reaches Google as query text. For the UAT account the new sort origin is still
Dallas, which is the ordering the report describes. It also sorts by one
distance while each row displays another (`distanceMeters`, measured from GPS)
whenever device coordinates are present, so the list can read "5 mi" above
"2 mi". Options: geocode the city token out of the query and use it as centre
+ sort origin, or rank venues whose `formattedAddress` contains the searched
city first, then by distance.

**2. `tsc --noEmit` was failing on the branch — fixed here.**
`__tests__/signInResendConfirmation.test.tsx(40,45): error TS2556`: `mockSignOut`
was `jest.fn(async () => …)`, a zero-arity signature, so the
`signOut: (...a: any[]) => mockSignOut(...a)` call site did not type-check.
Given a rest parameter. `tsc --noEmit` is now clean and that suite passes 8/8.
This is the one file this session edited in anyone else's lane; it is a
one-line test-mock fix on a failing gate, with the owning session finished.

**3. SKYC-137 interacts with the new Home query.** `scheduled_at` can now be
null, and `lib/homeGameQuery.ts` filters `gte`/`lt` on `scheduled_at`, so a TBD
game is excluded from Home entirely rather than shown as TBD. Also confirm the
sync upsert actually writes null over the World Series rows already stored with
a fake time, or those need a backfill.

**4. SKYC-136 Maestro flow — already handled, no action.** Checked
`qa/maestro/12_unverified_blocked.yaml`: it now accepts
"Confirm your email|Email not verified" and the widened body match, so the
flow matches the new error path.

## Note on SKYC-126

This session wrote a fix for it before reading the "deliberately unfixed"
constraint, then reverted it: `app/(auth)/sign-up.tsx` is back at HEAD and the
new test file is deleted. The patch is kept outside the repo and the Jira
ticket records what it contained. Nothing to merge.

## Gate state at 02:46 CDT (Claude, read-only except the TS2556 fix)

- `npx tsc --noEmit` — clean.
- `npx jest --runInBand` — **43 suites / 380 tests, all passing.**
- The default parallel `npx jest` run a few minutes earlier reported
  `mvpVoteZeroState.test.tsx` failing on Jest's 5 s per-test timeout (that suite
  took 13.9 s wall under load). It passes on its own and serially, so it is a
  timing flake, not a defect — but it will keep tripping CI on a loaded machine.
  Worth a `jest.setTimeout` bump or a lighter first render in that suite.
- This is the uncommitted working tree, not a commit. Migration 109 is still
  unapplied and `venue-search` is still undeployed.

## Final Codex review checkpoint

Claude's dedicated cross-review approved the Codex lane after changes: real guest
RSVP labels; accurate empty roster copy;10s Home timeout/abort, day-specific
cold/stale cache and refresh invalidation, explicit failed-load Retry; preserve
known kickoff on missing data but clear explicit provider TBD. No new remote SQL.
Peer finding131 is addressed by formatted-address city/state priority, because
profile-city search coordinates do not represent the typed city. Regression
fixtures distinguish Prosper TX from Prosper Road in Frisco. TS2556 and Maestro
contract are fixed. Both platform presets pass43suites/380tests. A CI-style
two-worker run checks the added30s component-test budgets for the observed flake.

Codex reviewed Claude's UI lane and tightened Leave Group to require returned
deleted membership rows before claiming success. My Sports total counts both
device picks and team-derived sports; the source distinction remains visible.
No conflicting sign-up workaround remains.126/129/134/138 still need reproduction.
All other19issues remain In Progress pending rollout and device acceptance.

See `docs/ios-uat-defect-remediation-2026-10-15.md` for the implementation/retest
map and explicit limits (unknown-date feed placement, existing private RSVP
admission, and supported city-query form). Codex will commit/push the combined
reviewed change on this branch; do not merge, deploy or close defects yet.

CI-style iOS with two workers passed all 380 tests and exited cleanly. The old
shared-useGames test fixture now disables GC timers and clears its test clients;
that resolved the teardown warning without changing any product behavior or
weakening assertions. New component tests have consistent 30s budgets. Android
CI-style verification and a durable evidence manifest accompany the commit.

Final CI-style result: both iOS and Android pass 43 suites / 380 tests and exit
cleanly. TypeScript and both Deno checks pass. Evidence is saved under
`qa/evidence/2026-10-15/uat-remediation/verification.json`. The combined patch is
approved for source review, with deployment and physical-device gates unchanged.

## Delivered handoff

- Source commit: `bfb6707ae9663da46f4015758858f06eaa0a0b7a`, pushed and remote verified.
- Draft PR: https://github.com/Mustattie/Fan_Wave/pull/21 (base `v9.5`).
- All 23 Jira remediation comments now link to this PR, source commit and evidence.
  Readback confirms 19 In Progress, four To Do, zero Done. Four held issues:
  SKYC-126, SKYC-129, SKYC-134, SKYC-138.
- No hosted migration, function deployment or new TestFlight build performed.
  Next acceptance gates remain the hosted staging/rollout and targeted device
  checklist in the remediation map. No manual production cleanup or store release.
