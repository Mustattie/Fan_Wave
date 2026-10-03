# Phase 1 verification record

Phase 1 (v9.5.15–v9.5.17, commits bc317fa, 042814e, 91fac18) is implemented
and committed. This file closes the gap in its **verification record**: which
device tests have a recorded pass, which do not, and what Build 32 must run.
Missing evidence does not mean a test failed or was not performed; it means
no record of the result survives in the repo or the report pages.

Sources: Phase 1 Device UAT Round 1 Findings (Build 26, 2026-09-23),
Stability Remediation Completion Report (Build 27, 2026-09-24), Build 28
Findings and Fixes, Build 29 Validation and UAT Checklist, commit bodies
bc317fa / 042814e / 91fac18 / f5207c8, and `docs/device-uat-history.md`.

## The original device test plan

The numbered plan was issued with the Build 26 UAT round and was not
committed to the repo. Its numbering is reconstructed from the Round 1
results table and the "remaining device tests" note on that page; the
verbatim text of tests 1 and 2 could not be recovered from any local record
or report page.

| # | Test (as reconstructed) | Recorded result | Where |
| --- | --- | --- | --- |
| 1 | not recoverable | — | — |
| 2 | not recoverable (Round 1 has a "3rd clip" row: three clips in a row, process restart observed, not the session race) | — | Round 1 findings |
| 3 | Kill the app during an upload; relaunch; the upload returns, completes, exactly one clip | **No recorded pass** | — |
| 4 | Background the app mid-upload for two full minutes | **PASS** on Build 26: auto-retry fired on return, finished about 3 s later without Retry | Round 1 findings |
| 5 | Airplane mode during an upload → failure message → reconnect → Retry → success | **Blocked**: New Clip preview rendered black and the 4th clip hit the free-tier paywall; the disconnect flow itself was never completed | Round 1 findings |
| 6 | Live-score navigation: Home and Game Day agree on a live game | **Defect found, still open**: Home lagged Game Day by up to 30 s (Home 79-67 Q4 1:11 vs Game Day 79-69 Q4 16.5). Cause: the games hook's 30 s AsyncStorage shortcut answers a realtime invalidation with the cached copy. v9.5.37 bypasses that shortcut on manual pull-to-refresh only; the realtime path still hits it | Round 1 findings; `hooks/useData.ts` |
| 7 | Two-account chat catch-up: device A offline while B sends two messages; both appear within ~10 s of A reconnecting, without leaving the conversation | **Never run** (7a/7b on Build 26 were My Sports variants, not chat) | Round 1 "remaining device tests" |
| 8 | Intentional sign-out | **PASS** on Build 26: normal Sign In, no unexpected-sign-out event | Round 1 findings |
| 9 | Server-side session revoke | **PASS** on Build 26: app dropped to Sign In; `auth.unexpected_signed_out` in Sentry | Round 1 findings |
| 10 | Reset-password and delete-account sign-outs | **Partial**: reset-password confirmed on Build 29 (link opens Set New Password, new password accepted, sign-in works); delete-account sign-out has no recorded result | Build 29 UAT; device-uat-history |

Cross-cutting checks with a recorded pass:

| Check | Result | Where |
| --- | --- | --- |
| Sentry delivery | PASS: `uat.sentry_smoke` x2, environment staging, Build 26 | Round 1 findings |
| Android memory (Phase 1 gate) | PASS on Build 27: Java Heap 21,052 → 51,432 (preview 1) → 51,656 → 46,140 → 53,932 KB across four previews, 60,012 with the paywall, 60,928 after background/return; no OOM | Completion Report |
| Basic offline recovery | PASS on Build 29: airplane mode showed the red banner; app recovered about 10 s after connectivity returned | device-uat-history |
| Password recovery | PASS on Build 29 | device-uat-history |
| Build 31 memory gate | Separate, later regression gate (P3.6); FAIL, see device-uat-history | — |

Phase 1 fixes 5–10 (v9.5.17) carried their own "requires retest" list in the
Completion Report; none has a recorded device result: feed cap at 200 with
hearts/follows intact after refresh (fix 5); 7-day failed-job expiry and a
stable cache directory after exports (fix 6); exactly one `presence.joined`
per group open (fix 7); one `link.consumed` per auth link (fix 8); own
content still shown after the `getLocalUser()` swap and a second-device
sign-out (fix 9); a watch party created on device A appearing live on
device B; Sentry clean of `OutOfMemoryError` and `realtime.channel_error`
for watch-parties.

## Migrations 099 and 100

Applied to production on 2026-09-24 and verified before commit 91fac18
(its body records this). Re-verified read-only on 2026-09-26 through the
Management API query endpoint:

| Probe | Result |
| --- | --- |
| `pg_get_functiondef('public.check_rate_limit(uuid,text,int,int)')` contains `auth.uid()` | true |
| `has_function_privilege('anon', 'public.check_rate_limit(...)', 'execute')` | false |
| `watch_parties` in publication `supabase_realtime` | 1 row |

Any earlier note that "099 remains deferred" is outdated. Do not apply
either migration again.

## Status at 2026-10-02 — Build 33 evidence plus owner attestation

Build 32 was emulator-only; the physical run happened on Build 33
(v9.5.41, f131669, S10+, 2026-10-01/02). On 2026-10-02 the owner stated
that the Phase 1 device tests were performed manually twice, directed
that one valid post-fix pass is sufficient, and that completed tests are
not to be rerun. The attestation is recorded as such; it is not turned
into a PASS where no observation of the result exists in the repo. Each
open row names the single missing datum instead of a rerun.

| # | Evidence on record | Status | Still needed (no rerun) |
| --- | --- | --- | --- |
| 3 | Build 33: force-stopped at "Posting… 45 %", relaunch resumed the job by itself, completed after one Retry, exactly one row `Build33_T3_kill` under a new path, no 409 in logcat | **PARTIAL — device recovery passed; Sentry pending** | Sentry filtered to build 33 shows no 409 (owner; the same sweep serves fixes 7–9 and row 17) |
| 4 | Build 26 PASS | closed | — |
| 5 | Build 33 PASS | closed | — |
| 6 | v9.5.40 (the fix) is in Build 33; the Padres–Cubs LIVE→FINAL update landed on Home and Game Day inside the same 30 s cycle | PARTIAL | One observation of two consecutive updates with a timestamp per screen, plus the Sentry `realtime.rejoin_failed` check. The 2026-10-02 17:38 CDT NHL run did not happen (the phone was disconnected at 17:10; `docs/codex-sync-2026-10-02.md` Sync 3). Stays PARTIAL if a future game yields fewer than two updates |
| 7 | Owner attests manual performance; no note in the repo records the observation (Build 26's 7a/7b were My Sports variants; Build 33 had no second device) | NOT RECORDED | Build number, date, and whether device B's two messages appeared on device A within ~10 s, each exactly once, without leaving the conversation. If the owner's own run notes hold this, copy it here; otherwise this is the one Phase 1 test that still needs a run |
| 8, 9 | Build 26 PASS | closed | — |
| 10a | Build 29 PASS (reset password) | closed | — |
| 10b | Owner attests manual performance; no recorded result | NOT RECORDED | Build number, date, clean return to Sign In after Delete account, and no `auth.unexpected_signed_out` in Sentry at that time |

Fixes 5–9 retest list, reusing Build 33 evidence where it overlaps:

| Fix | Overlapping evidence already on record | Still needed |
| --- | --- | --- |
| 5 — feed cap 200, hearts/follows intact after refresh | Build 33 row 3: 60 cards, no duplicates; the cap is unreachable with the 20 clips in prod, so cap behaviour rests on `__tests__/clipsFeed.test.ts` | Two observations: heart a clip, pull to refresh, the heart stays filled; follow a creator, pull to refresh, the follow stays (any build from 28 on). The cap itself has no device evidence |
| 6 — 7-day failed-job expiry, stable cache directory | TTL pinned by `__tests__/clipUploads.test.ts` ("drops a failed job older than 7 days"); Build 33 Tests 3/5 exercised the restore path (a failed job survived a force-stop and completed on Retry). A 7-day wait is not observable in a session | Unit evidence covers the TTL only. The stable cache directory (the same job directory before and after an export/restart) still needs one device check — `run-as` is refused on the preview build, so it needs a debuggable build or the job path logged by the app |
| 7 — one `presence.joined` per group open | None on Build 33 (rows 11/12 were not run; no group was opened) | Cannot be verified from the Build 33 sweep: zero group opens means zero expected joins. `presence.joined` is a breadcrumb (lib/realtime.ts), not a standalone event, so it needs one session that opens a group N times and then a captured Sentry event whose breadcrumb trail (or retained logcat from that session) shows exactly N `presence.joined` |
| 8 — one `link.consumed` per auth link | Build 29 password-recovery PASS (link opened Set New Password, new password accepted) on v9.5.18, which carries fix 8 | `link.consumed` is a breadcrumb (lib/supabase.ts, app/auth-callback.tsx), not a standalone event: needs a captured Sentry event whose trail, or retained logcat from that session, shows exactly one `link.consumed` for that link |
| 9 — own content after the `getLocalUser()` swap; second-device sign-out | Build 33: the uploader's own rows `Build33_T3_kill` and `Build33_T5_airplane` appeared in the feed on v9.5.41 | Second-device sign-out, taken with Test 7's second device |
| Party created on device A appears live on device B | None | With Test 7's second device |
| Sentry clean of `OutOfMemoryError` and `realtime.channel_error` (watch-parties) | Build 33 logcat: 0 OOM / 0 ANR | The same Sentry sweep |

Net: one Sentry sweep (owner), one two-update observation (not yet made;
the phone was disconnected before the 2026-10-02 17:30 game), one
second-device session (Test 7, fix 9's sign-out, cross-device party), one
throwaway-account deletion (10b), one heart-and-follow-after-refresh
glance, one stable-cache-directory check, and one captured-event check
each for the `presence.joined` and `link.consumed` breadcrumbs.

## What Build 32 must run to close Phase 1 (superseded by the table above; kept for the steps and pass criteria)

Run on the Galaxy S10+ after the P3.6 memory rows, on a build containing
v9.5.37–v9.5.39:

| Gap | Steps | Pass when |
| --- | --- | --- |
| Test 3 | Start a 20–30 s upload; force-quit from recents at ~50 %; relaunch | The card returns as queued/retrying, completes under a new path, exactly one clip row in the feed, no 409 in Sentry |
| Test 5 | Sign in as an MVP account (not the free tier); start an upload; airplane mode on at ~50 %; wait for the failure copy; airplane mode off; tap Retry | Friendly failure copy (not a raw native string); Retry succeeds; one clip; preview renders (not black) |
| Test 6 | Open a live game on Home and on Game Day on two devices, or Home then Game Day on one; watch two consecutive score updates | Both screens show each update within a few seconds of each other; no 30 s lag on Home; Sentry shows no `realtime.rejoin_failed`. If Home lags, the games-hook shortcut is the cause and needs a code change |
| Test 7 | Two accounts in the same group chat; device A airplane mode; device B sends two messages; A reconnects and stays in the conversation | Both messages appear on A within ~10 s, each exactly once |
| Test 10 (remainder) | Delete-account flow | Signs out cleanly; no `auth.unexpected_signed_out` |
| Fixes 5–9 retest list | As listed above | Each observed once |

Record results in `docs/device-uat-history.md` under the Build 32 entry.
