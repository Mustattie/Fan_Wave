# Migration 103 rewrite — handoff for Codex review (round 2)

Date: 2026-10-02. Branch: `worktree-phase2-migration103`, rebased onto the
v9.5 tip `950196b` (clean; the tip only added three docs files). All work
is uncommitted in the worktree. Nothing applied, deployed, built, or
pushed. The main checkout and its UAT edits were not touched. The Game
Day Predictions investigation was not touched.

## Round-2 blockers and what changed

| # | Codex blocker | Resolution |
| --- | --- | --- |
| 1 | Clients pass literal free-tier limits, so paid users stayed at 5 clips/h, 10 moments/h, 20 RSVPs/day | `app/create-clip.tsx`, `components/MomentsFeed.tsx`, `app/watch-party/[id].tsx` now pass `null` for `p_max_count` and `p_window_seconds`; the server's `rate_limit_ceiling` is the authority. Chat (`app/fan-group/[id].tsx`, both call sites) keeps its explicit 60/60 because that ceiling does not vary by tier. The server still refuses to loosen: a caller's number is only ever a tightening. T9 drives the exact RPC contract: free gets 5/10/20, Home Team 30/60/100, chat 60 for every tier, an old build sending 5/3600 is still honoured as a tightening, and a 1,000,000/s request is clamped to the tier ceiling |
| 2 | `rate_limit_consume` read SUM then INSERT with no serialisation | Both `rate_limit_consume` and `check_rate_limit` take `pg_advisory_xact_lock(hashtextextended('rate_limit:'‖action‖':'‖user, 0))` before counting. The lock is transaction-scoped, so it is released exactly when the new ledger row becomes visible to the next waiter. Sliding-window semantics are unchanged. Concurrency test: 8 connections, one user 5 short of the 60/min ceiling, 24 attempts that each hold their transaction open 250 ms. Exactly 5 land and the ledger reads 60. `RACE_DEMO=1` first runs the same race against a copy of the function with the lock stripped: 8 landed / ledger 63, i.e. the test catches the overshoot it exists for |
| 3 | 102's `request.jwt.claims` cast had no `NULLIF` guard | `supabase/migrations/102_clip_quota_server_enforced.sql`: `enforce_clip_quota` reads the role with the same `NULLIF` guards as 103 and limits only JWT roles `authenticated`/`anon`. service_role and no-JWT operator sessions pass; an empty-string claims setting reads as "no JWT". T13 covers: end user held at 3/24 h; operator insert with no claims; operator insert with `''` claims (previously "invalid input syntax for type json"); service_role insert; end user still held afterwards; no 103 budget drawn by the operator inserts. The test helper's earlier service_role workaround is gone, so T6 also seeds clips with `''` claims through the fixed 102 |
| 4 | 429 client handling | Changed, see below |
| 5 | Rebase onto `950196b` | Done via a temporary WIP commit that was rebased then un-committed (`git reset --mixed`); HEAD is `950196b`, work is uncommitted |

### 429 handling on the client (changed)

- `lib/clipUploads.ts`: new `UploadErrorKind` `'rate_limited'` (error code `PT429` or a "rate limit" message). Friendly copy: "You've posted a lot of clips in a short time. Your clip is saved here; tap Retry in a little while." Not auto-retried (the window has to pass); the job stays on the card for manual Retry, as the other non-transient kinds do. Blob cleanup on insert failure is unchanged (the retry re-uploads). Test added in `__tests__/clipUploads.test.ts`.
- `app/fan-group/[id].tsx` (text send): a `PT429` insert error now shows "Slow down" with the server message instead of silently removing the optimistic bubble. Reached only when the advisory pre-check fails open (timeout) or is absent. The media-attach path already surfaced `error.message`.
- `components/MomentsFeed.tsx`: `PT429` shows "Slow down" with the server message instead of "Something went wrong".
- `app/watch-party/[id].tsx`: `PT429` is handled before the 42501 branch, so a throttle rolls back the optimistic pill and shows "Slow down" rather than the upgrade prompt.
- `app/create-watch-party.tsx`: `PT429` shows the server message instead of the generic "Could not create watch party".
- Unchanged because already adequate: `components/ClipCommentsSheet.tsx` and `components/WatchPartyCard.tsx` show `error.message`, which is the user-readable server text.

### Also changed

- `jest.android.config.js`: the babel preset path is now `require.resolve('expo/internal/babel-preset.js')` instead of a `node_modules` path under `__dirname`. The old form fails in any git worktree that borrows the main checkout's `node_modules` (every suite errored with "Cannot find module"). Same preset, same behaviour in the main checkout.
- `tests/load/lib/http.js`: comment only (ceilings raise PT429 → HTTP 429, not P0001).

## Changed files

| File | Change |
| --- | --- |
| `supabase/migrations/103_rate_limit_server_ceilings.sql` | Tier-aware rewrite: single ceiling source, AFTER INSERT triggers on 8 tables, operator exemption, PT429, bounded GC, advisory-lock serialisation in both counting paths, executable reversal |
| `supabase/migrations/102_clip_quota_server_enforced.sql` | `NULLIF` guard on claims; end-user-JWT-roles-only enforcement; header updated |
| `supabase/tests/103/fixture_schema.sql` | New. Minimal schema on which the real 099, 073, 102 and 103 apply unchanged |
| `supabase/tests/103/test_103_rate_limit_ceilings.sql` | New. 13 behaviour blocks |
| `supabase/tests/103/concurrency_worker.sql` | New. One concurrent writer for the race test |
| `scripts/test-migration-103.mjs` | New. Scratch-Postgres runner: fixture → 099 → 073 → 102 → 103 ×2 → tests → race (optional unlocked demo) → reversal + 099 → re-apply |
| `app/create-clip.tsx`, `components/MomentsFeed.tsx`, `app/watch-party/[id].tsx` | Pre-check passes `null` numbers; 429 copy |
| `app/fan-group/[id].tsx`, `app/create-watch-party.tsx` | 429 copy |
| `lib/clipUploads.ts`, `__tests__/clipUploads.test.ts` | `rate_limited` kind + test |
| `jest.android.config.js` | Worktree-safe preset resolution |
| `tests/load/lib/http.js` | Comment |
| `docs/migration-103-rewrite-handoff.md` | This file |

## Original failure modes (readiness review of v9.5.28) and fixes

1. 5 clips/h applied to paid tiers → `rate_limit_ceiling(action, tier)`; free keeps 099's numbers, Home Team+ get abuse ceilings (clips 30/h, moments 60/h, RSVPs 100/day, parties 50/day; chat, comments, likes, follows unchanged). Reviewer accounts resolve to `mvp` via `get_user_tier`.
2. Operator inserts refused → only JWT roles `authenticated`/`anon` are limited; `rate_limit_request_role()` reads claims with `NULLIF` guards.
3. BEFORE INSERT charged upserts → row-level AFTER INSERT; Postgres fires it only for rows actually inserted, so `ON CONFLICT DO UPDATE`/`DO NOTHING`, UPDATE paths and rows refused by the 102 quota cost nothing. A refusal still rolls the statement back, through the RPC.
4. No match_moments trigger → eighth trigger.
5. Two sources of truth → `check_rate_limit` (same signature/semantics as 099) reads `rate_limit_ceiling`.
6. No GC from the trigger path → `rate_limit_gc(limit)`, bounded one-day sweep on ~1 % of consumes; the 052/099 cron stays primary.
7. `rate_limit_ceiling` PUBLIC-executable → EXECUTE revoked on every helper; first-draft overloads dropped if present.

Refusals raise `PT429` (PostgREST HTTP 429, supabase-js `error.code = 'PT429'`), not 42501, because the RSVP screen treats 42501 as an entitlement failure. Message text contains "Rate limit" and "too many" (k6 taxonomy), hint `rate_limited:<action>`, detail `limit N per W seconds`. Bucket keys stay `<table>_insert`, separate from the client's advisory keys. Identity is `auth.uid()` when present, row column as fallback.

## Validation run (2026-10-02, PostgreSQL 18.1, Node 24)

```
node scripts/test-migration-103.mjs            (RACE_DEMO=1 for the unlocked demonstration)
PASS  grammar (pglast) — 34 statements, 5 function bodies parsed, 1 trigger body left to the server
PASS  scratch cluster
PASS  fixture schema
PASS  real 099 + 073 + 102 applied on the fixture
PASS  103 applied twice without error
  ok: T1  shape — 8 AFTER INSERT triggers, helpers locked down, one source of truth
  ok: T2  free user — 60 messages pass, 61st raises PT429 with hint/detail, row rolled back
  ok: T3  operator, empty-claims and service_role inserts are free; JWT subject keys the bucket
  ok: T4  anon-role writes draw from the budget
  ok: T5  clips — free capped by 102 at 3 (no rate cost), home_team and reviewer get 30/h then PT429
  ok: T6  upserts — DO NOTHING / DO UPDATE / status flips cost nothing; only real inserts count
  ok: T7  match_moments — 10/h for free, 11th raises PT429
  ok: T8  watch_parties — free 10/day, mvp 50/day
  ok: T9  check_rate_limit via the client contract — free 5/10/20, home_team 30/60/100, chat 60 for all, tighten-only, uid from JWT
  ok: T10 a full bucket frees up once its window has passed
  ok: T11 rate_limit_gc — bounded, one-day retention
  ok: T12 PT429 propagates through rsvp_to_watch_party and the whole RPC rolls back
  ok: T13 migration 102 — quota holds for the end user; no-JWT, empty-claims and service_role operator inserts pass
PASS  behaviour tests — 13 blocks
INFO  race demo WITHOUT advisory lock: 8 rows landed / ledger 63 (ceiling 60 — OVERSHOT, as expected without the lock)
PASS  concurrency (advisory lock) — 24 concurrent attempts, 5 landed, ledger 60
PASS  reversal restores the 099 state
PASS  103 re-applies cleanly after reversal
ALL PASS (9 steps)

npx tsc --noEmit                                 clean
npx jest --ci --maxWorkers=2                     25 suites, 202/202
npm run test:android                             25 suites, 202/202
```

pglast cannot serialise any trigger-function body in this repo (080, 089, 102 fail the same way), so trigger bodies are checked by the scratch server compiling and executing them.

Not run: anything against Supabase, any device or EAS step.

## Rollback

103's footer carries executable reversal blocks, replayed by the runner: drop the 8 triggers and trigger-path functions (A), re-run 099 in full to restore the previous `check_rate_limit` body, then drop `rate_limit_gc` and `rate_limit_ceiling` (B). Order matters because `check_rate_limit` depends on `rate_limit_ceiling`. Ledger rows under the `<table>_insert` keys age out within a day. No table, column or row is dropped.

102's own reversal block is unchanged. Note that after this change 102 is more permissive for operator sessions, not less; nothing an end user can do changed.

Client changes are compatible with both the current prod server (099: `COALESCE(p_max_count, v_max)` already handles `null`) and 103, so they can ship in any order relative to the migration. Until 103 is applied, a paid user sending `null` gets 099's free numbers, exactly what they get today.

Apply-time pre-checks remain in 103's header. 102 and 103 may be applied in either order.

## Unresolved owner decisions

1. **Paid abuse ceilings.** 30 clips/h, 60 moments/h, 100 RSVPs/day, 50 parties/day for `home_team`+ are my numbers against a product promise of "unlimited". One place to change: `rate_limit_ceiling`.
2. **102 operator semantics.** The fix makes no-JWT sessions exempt from the free-tier clip quota (consistent with 103). If the owner wants operator inserts on behalf of free users to still count against the quota, the exemption should be `service_role`-only with the `NULLIF` guard kept.
3. **Clip blob on 429.** An insert refused with 429 still deletes the just-uploaded blob (pre-existing policy for any failed insert) and the manual Retry re-uploads it. Keeping the blob for a 429 would save bandwidth but needs the reconcile-by-URL path to accept an orphan; deferred.
