# iOS UAT defect remediation — 2026-10-15

Branch: `codex/ios-uat-defects`. Scope: **23 issues, SKYC-123–SKYC-145** on
[peacefuldata Jira](https://peacefuldata.atlassian.net/issues/?jql=project%20%3D%20SKYC%20AND%20labels%20%3D%20%22uat-2026-10-14%22).
The owner confirmed 25 was approximate.

Codex and Claude share the implementation and cross-review. Jira remains the
defect source of truth. No issue is closed on source/unit evidence alone.
The imported tickets describe iOS18.3 simulators at b9b75b9; these records do not
establish physical TestFlight results.

## Implementation and retest map

| Issues | Change | Remaining gate |
|---|---|---|
| 123,124,142 | New migration109: auth.uid identity; no anon execute; private stranger guard; own RSVP visible; declined totals. Client uses declined; old cant_go writes normalized. Honest RSVP error. | Hosted staging identity/visibility and RSVP cycle; approved rollout; app/device retest |
| 125 | Verified non-anonymous user and atomic20/min limit before Google Places | Hosted staging auth/quota tests, deployment |
| 127 | Paginate the complete local calendar day before sports filtering | Device Today/Yesterday, minority-sport and timezone checks |
| 128 | Search joined/suggested groups, count active tab, accurate empty/search states | Device search and tab retest |
| 130,143 | Member leave action, owner guard, clear member-only messages and membership-aware empty copy | Join/leave/rejoin, count and privacy device retest |
| 131 | Rank venues near searched city; user distance remains display-only | Staging/device search from another city |
| 132 | Manual venue needs name and address | Device validation |
| 133 | Home Create watch party button role and label | VoiceOver |
| 135 | Separate saved preferences from OS delivery, honest unknown/failed-load state | Denied/granted OS permission and background-return device checks |
| 136 | Resend on unconfirmed-email error without session, persistent control, Maestro aligned | Auth email delivery + Maestro on device |
| 137 | Invalid/unknown ESPN kickoff becomes null, no invented current time | Staging sync and TBD rendering, no manual production cleanup |
| 139,140 | Show sports derived from followed teams separately from editable picks; uniform incomplete grid rows | Two-device follow/deselection, narrow/wide layout |
| 141 | Card uses Maybe consistently | Detail/card/history cycle |
| 144 | Yesterday-specific empty-state copy | Device empty-day |
| 145 | Zero-vote state and honest failed tally read | Zero/one-sided/even split, vote success/failure |

The19 implementation issues are In Progress. Four remain To Do pending evidence:

- **126:** physical iPhone with Keychain and AutoFill enabled; typed, suggested and
  pasted passwords. Do not disable password-manager support on simulator evidence.
- **129:** reproduce keyboard and footer coordinate overlap. Jira attachment10051
  shows a post-create alert, but does not establish the cause of the tap.
- **134:** physical playback failure with clip id and `clips:playerStatus` error.
  That telemetry already exists; the initial Claude review missed it.
- **138:** reproducible wrong-logo sequence and source/team identity before a fix.

## Validation

- Initial iOS run:37suites /314tests passed. Jest remained alive briefly after
  results due to open handles; it subsequently exited0.
- Discover focused run:9tests passed after correcting a singular/plural test
  helper. First instrumented run failed and is superseded by the corrected run.
- TypeScript passed during implementation; final gate recorded below when ready.
- Deno check passed for venue-search and sync-game-schedules. Two pre-existing
  typing issues in sync were repaired without runtime changes: missing provider
  method signature and concatenated selection string losing literal inference.
- Migration109 executed in an isolated local PostgreSQL cluster, not Supabase:
  anon permission denied, private stranger no rows, spoofed viewer ignored,
  host own Maybe visible, legacy cant_go normalized, canonical cycle/totals pass.
  Fixture uses simplified tables/auth stubs; hosted RLS/triggers and integration
  remain staging gates. The local test cluster was stopped.
- SQL fixture: `supabase/tests/109/local_fixture.sql`; run only in an empty,
  disposable local database. It creates roles/tables and is never a hosted script.
- No physical device, hosted migration, production writes, function deployment,
  TestFlight build, App Store review or public release performed for this change.

## Rollout scope for later approval

Review migration109 and deploy **venue-search** and **sync-game-schedules** after
staging checks. Capture each deployed definition/ACL for rollback immediately
before applying. Do not replay the historical migration ledger (previously stale
at063). Do not change past migrations. No data cleanup/backfill is bundled.
Build an iOS candidate from the exact reviewed commit for targeted device retests.
Existing load-test harness validity and release gates remain separate and open.

## Final code review checkpoint

- Claude's static cross-review verdict: **APPROVE** after resolving real guest
  RSVP labels, restoring Home timeout/offline/refetch behavior, and preserving
  known kickoff time when provider data is missing. Explicit timeValid=false
  still clears the false placeholder. Review SHA256:
  `6518F377849F9357DB34E5977AC0B19834C174019A5E076E6461BBBD1CF8497E`.
- Codex reviewed Claude's UI lane, added an affected-row check to Leave Group,
  corrected total-followed counting and test assertions, and aligned Maestro.
- Final serial iOS and Android: **43 suites / 380 tests passed on each platform**.
  TypeScript and both Deno function checks passed. New component tests use 30s
  test budgets after a parallel-run 5s timeout. CI-style runs with two workers
  passed all 380 tests on each platform and exited cleanly after fixing test
  QueryClient garbage-collection timers. Results and source hashes are saved in
  `qa/evidence/2026-10-15/uat-remediation/verification.json`.
- Unknown-date games cannot be assigned to a calendar-day feed. Explicit TBD
  rows have null kickoff and are not expired by the old timestamp-based cron;
  no retention change or cleanup is included. Validate desired TBD discovery
  behavior in staging rather than advertising a fake kickoff to keep a row visible.
- Private roster reads now reject anon/spoofed identity. Existing private RSVP
  admission is still self-service in the older write RPC; this patch does not
  claim to introduce a verified-invite authorization system.
- City ranking recognizes trailing US state abbreviations (e.g. Prosper TX).
  Full state names and other query forms retain distance ordering.
