# Load tests (k6)

Signed-in k6 scenarios for the 50k–100k-user World Cup / game-week prep.
Everything here targets a **staging** Supabase project. `lib/config.js`
throws in the init context if `SUPABASE_URL` or the key is the production
project (`fwlfiejvxmslkpoojggs`), so no script can start against prod.

> **Status (2026-10-05):** Staging load tests completed on commit `aa1524f`
> against `azkmymxdjylmkytrvyfn` (resized Micro → Small, then restored to
> Micro ACTIVE_HEALTHY). **Primary 600-user read+RSVP spike: PASS.** **Chat +
> Realtime simultaneous 600+600 burst: FAIL on error threshold.** See
> "Load-test results" immediately below for the detailed pass/fail split,
> compute size, result file paths, and next-action recommendation.

## Load-test results (2026-10-05)

**Staging project:** `azkmymxdjylmkytrvyfn` (resized ci_micro → ci_small for test, restored ci_micro ACTIVE_HEALTHY)
**Production:** `fwlfiejvxmslkpoojggs` untouched
**Commit:** `aa1524fcba62459851f802293345697f90c33626`

### Pass: Primary 600-user spike, read + RSVP

| Scenario | Result file | Profile | Test | p95 / p99 | Errors | 429s | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Read spike (feed + hold) | `tests/load/results/spike-readmix-small-20261005.json` | spike (600 VUs) | `spike-test.js` | feed 399.4ms, hold 384.6ms | 1/179760 (0.0006%) | 0 | ✓ PASS |
| Spike burst (10 s) | same | spike (600 VUs) | `spike-test.js` | p99 1036.1ms | — | — | ✓ PASS |
| RSVP 600-arrival burst | `tests/load/results/spike-rsvp-small-20261005.json` | spike (600 VUs) | `watch-party-rsvp.js` | p95 296.6ms | 0% | 0% | ✓ PASS |

All metrics within gate thresholds: feed/hold/RSVP latency ✓, error rate < 1% ✓, zero rate-limit refusals ✓. One TCP connection attempt timed out in the read spike (1 of 179,760 operations), within the error gate.

### Fail: 600+600 simultaneous chat + Realtime sockets

| Scenario | Result file | Profile | Test | Errors | Status |
| --- | --- | --- | --- | --- | --- |
| Chat 600-writer burst | `tests/load/results/spike-chat-small-20261005.json` | spike (600 VUs) | `chat-send.js` | 1.827% (300/16418) | ✗ FAIL (gate: < 1%) |
| Realtime 600-socket join | `tests/load/results/spike-ws-small-20261005.json` | spike (600 VUs) | `realtime-ws.js` | sustained db timeouts | ✗ PARTIAL (diagnostic) |

Chat errors exceeded threshold during a simultaneous 600 concurrent Realtime socket test. Realtime emitted `{:error, "Too many database timeouts"}` on games-realtime and room-messages-* topics; connect errors 0.167% ✓, but join success 95.160% (gate: > 99%) ✗. The run was stopped after chat already failed. This defines a **600+600 simultaneous two-campus chat+Realtime ceiling**, not a regression: the existing 300-user campus (chat + Realtime paired, same profiles) remains **PASS** (see 2026-10-04 baseline and campus runs for evidence).

### Recommendation

1. **Keep the current 300-user campus target green.** The 600-user read and RSVP scenarios pass their gates on Small. The simultaneous chat+Realtime burst (600+600 VUs on the same staging instance) exceeds the measured capacity and requires investigation of the observed database timeouts plus a green rerun before claiming two-campus co-load support.
2. **Do not claim two-campus simultaneous chat+Realtime support yet.** Micro's earlier read spike (from 2026-10-04) failed latency (feed p95 4.36s, hold p95 4.42s). Small resolves the primary read and RSVP gates, but the paired chat/Realtime run still fails. Determine whether configuration, schema/query behavior, or a larger compute tier is needed, then rerun the unchanged pair without weakening its gates.
## Scripts

| Script | What it measures | Needs |
| --- | --- | --- |
| `home-screen.js` | Screen-open feed: games + parties near city + public groups + clips page 0 | — |
| `spike-test.js` | Kickoff spike: baseline → stage peak in 10 s, hold, cool down; read mix | — |
| `chat-send.js` | `check_rate_limit` + `messages` INSERT, one room | `CHAT_ROOM_ID` (public room) |
| `watch-party-rsvp.js` | `rsvp_to_watch_party` burst on one party: one going→none cycle per VU, arrivals spread linearly across a third of the profile's ramp (row lock + capacity concurrency, not abuse rate) | `PARTY_ID` |
| `realtime-ws.js` | Phoenix socket join (games + room channel), heartbeat, drop + rejoin ≤ 10 s | `CHAT_ROOM_ID` optional |

Shared modules: `lib/config.js` (env, prod guard, stage profiles, thresholds),
`lib/auth.js` (per-VU sessions), `lib/http.js` (timed requests, error vs
rate-limit taxonomy), `requirements.json` (the relations, columns and RPCs
the scripts need; `__tests__/loadTestRequirements.test.ts` keeps it in step
with the scripts and `scripts/load/preflight.mjs` checks it against the
target).

## College-launch profiles (first campus)

`--env STAGE=baseline|campus|spike` selects a profile sized for one campus
in its first term rather than the World Cup stages below. Assumptions,
written down so they can be challenged: about 2 000 installs on the
campus, roughly 10 % of them in the app at once on an ordinary evening,
about one in four open during a big game, and a kickoff / final-whistle
burst that doubles the game-night peak for a few seconds. One VU is one
signed-in session that behaves like the app (feed open, think time, a chat
send every 2–6 s).

| Profile | Models | VUs | Ramp | Hold | Down | Wall clock |
| --- | --- | --- | --- | --- | --- | --- |
| `baseline` | ordinary weeknight evening | 50 | 1 m | 5 m | 30 s | 6.5 m |
| `campus` | game night across one campus | 300 | 3 m | 10 m | 1 m | 14 m |
| `spike` | kickoff / final whistle on game night | 600 | 10 s (spike-test: 30 → 600) | 3 m | 1 m | about 4.5 m |

`watch-party-rsvp` uses the profile's VU count and ramp, not its hold:
it runs `per-vu-iterations` with exactly one iteration per VU, and each VU
performs one going→none cycle (a short dwell between the two calls) and
exits. The arrival shape is the committed one — reach the peak in a third
of the profile's ramp (`shrink(PROFILE.ramp, 3)`, floored at 10 s) — but
because `per-vu-iterations` has no ramp of its own, each VU sleeps before
its "going" call so the VUs are spread linearly across that window: VU n
(1-based) starts at (n − 1) × window ÷ VUs seconds. The window is derived
from the profile alone; there is no env override that could widen it.

| Profile | VUs | Ramp | Arrival window | Spacing |
| --- | --- | --- | --- | --- |
| `baseline` | 50 | 1 m | 20 s | one "going" every 0.4 s |
| `campus` | 300 | 3 m | 60 s | one every 0.2 s |
| `spike` | 600 | 10 s | 10 s | one every 17 ms |

`spike` is the honest schema stress gate for the RSVP path: 600 arrivals
on one `watch_parties` row inside 10 s, every one of them taking the
migration 073 row lock. Passing `baseline` and `campus` proves ordinary
evenings and game nights; passing `spike` is what proves the schema.

It does not loop, because migration 103 caps `watch_party_rsvps` INSERTs
at **20 per user per day** on the free tier (100/day paid; the window is
86 400 s, see `rate_limit_ceiling` in migration 103). A looping toggle
spends that budget in minutes and the remainder of the run is PT429 noise
(baseline on staging with the old looping script: 1 000 successes — 50
users × 20 — then 2 138 HTTP 429s). One cycle per VU costs each load user
one of its 20 daily INSERTs (the cancel is a DELETE and does not count), so
the same user pool supports at most 20 runs in a day, fewer if the users
have RSVPed through the app that day. Repeat runs therefore need fresh or
rotated users: re-seed with `scripts/load/seed-users.mjs`, or point
`LOAD_USERS_FILE` / `LOAD_TOKENS_FILE` at a pool that has not run today.

Diagnostic record (staging, 2026-10-04, `baseline`, 50 VUs, one cycle
each, `rsvp_ok` 100 %):

| RPC under test | Arrival | `rsvp_ok` | `rsvp_latency` p95 | Result |
| --- | --- | --- | --- | --- |
| migration 073 `rsvp_to_watch_party` | all 50 at once (no stagger) | 100 % | 1.4569 s | functionally correct; failed the 1 s gate |
| migration 109 candidate (no shared party-row lock) | all 50 at once (no stagger) | 100 % | 3.98 s | worse; rejected and rolled back on staging |

The instantaneous 50-VU burst was never the committed arrival model (the
committed scenario ramped to 50 over 20 s), so the 1.4569 s p95 measured a
shape the gate was not written for. Migration 109 was an attempt to remove
the 073 row lock to pass that shape; it made p95 worse and has been
deleted from the tree. Migration 073 stays as the RSVP RPC. The staggered
arrival above restores the committed model; the gates are unchanged.

Thresholds are the stage-gate rules below, unchanged: they are per-request
latencies and error rates, so they do not loosen for a smaller audience.

| What must hold | Gate | Script |
| --- | --- | --- |
| Each screen-open query (games, parties, groups, clips) | p95 < 800 ms | `home-screen`, `spike-test` (hold phase) |
| Spike phase (the 10 s burst) | p99 < 5 s; p95 reported, not gated | `spike-test` |
| Chat send (`check_rate_limit` + insert) | p95 < 1 s, p99 < 3 s | `chat-send` |
| RSVP toggle | p95 < 1 s; `rsvp_ok` = 100 % (every going and every cancel 2xx; a 429, capacity-full P0001 or 5xx fails the run) | `watch-party-rsvp` |
| Non-rate-limit errors | < 1 %; k6 aborts the run once it has been over the line for 60 s (stop rule) | all |
| Socket connect errors / join success / rejoin within 10 s | < 0.5 % / > 99 % / ≥ 99 % | `realtime-ws` |
| Rate-limit refusals (`rate_limited`, HTTP 429 from migration 103) | reported, not an error, except in `watch-party-rsvp` where a 429 fails `rsvp_ok`; `chat-send` stays under the 60/min ceiling by design, so any 429 there is a server finding | all |

Run order, once per profile, baseline → campus → spike, never skipping and
never proceeding past a failed profile:

```
npm run load:preflight -- --stage campus            # must print READY
node scripts/load/mint-tokens.mjs --rps 5           # campus and spike (300 / 600 VUs)
k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=campus \
       --env LOAD_TOKENS_FILE=C:/abs/path/fan-wave-app/tests/load/tokens.json \
       --summary-export=tests/load/results/campus-home.json tests/load/home-screen.js
k6 run ... --env STAGE=campus --env CHAT_ROOM_ID=<uuid> --summary-export=tests/load/results/campus-chat.json tests/load/chat-send.js
k6 run ... --env STAGE=campus --env CHAT_ROOM_ID=<uuid> --summary-export=tests/load/results/campus-ws.json tests/load/realtime-ws.js   # second terminal, alongside chat-send
k6 run ... --env STAGE=campus --env PARTY_ID=<uuid> --summary-export=tests/load/results/campus-rsvp.json tests/load/watch-party-rsvp.js
k6 run ... --env STAGE=spike --summary-export=tests/load/results/spike.json tests/load/spike-test.js
```

Record per run: profile, script, staging ref, commit, date, the summary
JSON path, every threshold's pass/fail, and the Supabase dashboard's CPU,
connection and Realtime-connection peaks during the hold. A campus that
passes `spike` has head-room for about two campuses on `campus`; the World
Cup stages below are the path beyond that.

## Stage profiles

`--env STAGE=n` selects peak VUs and ramp/hold/ramp-down:

| Stage | VUs | Ramp | Hold | Down | Wall clock |
| --- | --- | --- | --- | --- | --- |
| 1 | 100 | 1 m | 3 m | 30 s | 4.5 m |
| 2 | 500 | 2 m | 5 m | 1 m | 8 m |
| 3 | 1 000 | 3 m | 5 m | 1 m | 9 m |
| 4 | 5 000 | 5 m | 5 m | 2 m | 12 m |
| 5 | 10 000 | 5 m | 10 m | 2 m | 17 m |

One VU ≈ one signed-in app session. Stage 5 needs ~10 000 open sockets for
`realtime-ws.js`, which a laptop cannot hold; run it from a cloud VM or
split with `k6 run --execution-segment 0:1/2 …` / `1/2:1` on two machines.

## Stage gate rules

Run stages in order. Never skip a stage. Do not proceed past a stage whose
thresholds fail; fix, re-run the same stage, then continue.

| Metric | Gate | Where |
| --- | --- | --- |
| `feed_latency`, `games_latency`, `parties_latency`, `groups_latency`, `clips_latency` | p95 < 800 ms | home-screen, spike |
| `chat_send` | p95 < 1 s, p99 < 3 s | chat-send |
| `rsvp_latency` | p95 < 1 s | watch-party-rsvp |
| `rsvp_ok` | = 100 % (any non-2xx going or cancel, 429 included, fails) | watch-party-rsvp |
| `errors` | < 1 % | all |
| `ws_connect_errors` | < 0.5 % | realtime-ws |
| `ws_join_ok` | > 99 % | realtime-ws |
| `ws_rejoin_within_10s` | ≥ 99 % | realtime-ws |

`rate_limited` (429 / mig 103 ceilings) is reported separately and is not an
error: a run that is throttled by design tells you the ceilings work; a run
that is throttled unexpectedly tells you a ceiling is too low for the
target user count. The one exception is `watch-party-rsvp`: its `rsvp_ok`
gate counts a 429 as a failed RSVP, because that scenario is sized to stay
under migration 103's 20-per-user-per-day RSVP ceiling (one INSERT per
user per run) and a 429 there means the pool's daily budget was already
spent or the ceiling is wrong. Rotate to fresh load users rather than
loosening the gate.

## One-time setup

1. Have k6 available: `winget install k6 --source winget` (macOS: `brew install
   k6`), or a portable copy at
   `%LOCALAPPDATA%\FanSphereTools\k6\k6-v<ver>-windows-amd64\k6.exe`, or
   any path in `K6_BIN`. The preflight picks `K6_BIN`, then the portable
   copy, then PATH, and prints which one it will use. Nothing else here
   needs k6. When k6 comes from `K6_BIN` or the portable copy, invoke it by
   that path in the `k6 run` commands below.
2. Create `fan-wave-app/.env.loadtest` (gitignored):
   ```
   STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
   STAGING_SUPABASE_ANON_KEY=<staging anon / publishable key>
   STAGING_SERVICE_ROLE_KEY=<staging service_role (secret) key>
   ```
   All three are required. Each key has one job: k6 runs with
   `STAGING_SUPABASE_ANON_KEY` (passed as `SUPABASE_ANON_KEY` below) and
   never sees the service key; the preflight's schema check reads the
   project's OpenAPI document (`GET /rest/v1/`) with
   `STAGING_SERVICE_ROLE_KEY`, because Supabase serves that root endpoint
   only to a secret key — the anon/publishable key is answered with
   `401 {"message":"Secret API key required"}` (confirmed on the staging
   project on 2026-10-04 after the migration replay). Seeding and cleanup
   use the service key too. With the service key missing, the preflight
   reports `STAGING_SERVICE_ROLE_KEY is not set; schema verification cannot
   run without it` as a blocker rather than silently skipping the check.
   Then `npm run load:preflight -- --stage baseline`. It is read-only: it
   refuses the prod ref in the URL or in either key's JWT claim, looks the
   project up by name and status through the Management API (a name
   containing "prod" is refused), checks every relation, column and RPC in
   `requirements.json` against the project's OpenAPI document (one GET with
   the service key), and checks the seeded-user and token counts for the
   profile. It prints no secret. `LOADTEST_ENV_FILE=<path>` makes it read
   that dotenv file instead of `fan-wave-app/.env.loadtest`; the Jest
   suite sets it to a nonexistent path so its offline cases never pick up
   a real file.
3. Seed users (creates confirmed accounts, sets `home_city`):
   ```
   node scripts/load/seed-users.mjs --count 100 --city Chicago      # stage 1
   node scripts/load/seed-users.mjs --count 10000 --city Chicago    # stage 5 (appends)
   ```
4. Create fixtures on staging with the app or Studio and note their ids:
   a public `chat_rooms` row (`CHAT_ROOM_ID`) and a `watch_parties` row with
   capacity NULL or ≥ stage VUs (`PARTY_ID`), starting in the future.

## Running a stage

Stage 1 can mint tokens inside k6 (`setup()` paces at 5/s):

```
cd fan-wave-app
k6 run --env SUPABASE_URL=https://<staging>.supabase.co \
       --env SUPABASE_ANON_KEY=<anon> --env STAGE=1 \
       --env HOME_CITY=Chicago tests/load/home-screen.js
```

Stage 2+ should pre-mint (sign-in rate bucket, and setup time):

```
node scripts/load/mint-tokens.mjs --rps 5          # writes tests/load/tokens.json
k6 run --env SUPABASE_URL=... --env SUPABASE_ANON_KEY=... --env STAGE=2 \
       --env LOAD_TOKENS_FILE=C:/abs/path/fan-wave-app/tests/load/tokens.json \
       tests/load/home-screen.js
```

Tokens expire 3600 s after minting; `lib/auth.js` refuses a run that would
outlive them. Re-mint between stages.

Order per stage: `home-screen` → `spike-test` → `chat-send` + `realtime-ws`
together (same `CHAT_ROOM_ID`, two terminals) → `watch-party-rsvp`.

Save each summary: `k6 run … --summary-export=results/stage1-home.json`.

Clean up afterwards (dry run first):

```
node scripts/load/cleanup-users.mjs
node scripts/load/cleanup-users.mjs --apply
```

## Standing up staging

There is no staging Supabase yet. Two ways to get one; both change a
Supabase project's schema and therefore need the owner's explicit approval
first (CODEX_PROJECT_CONTEXT §1):

**A. Bring the legacy dev project up to date (quickest).**
`azkmymxdjylmkytrvyfn` ("Fan Wave") is ACTIVE_HEALTHY with 45 migrations
applied (through 045), 6 auth users, Postgres 17.6, region ca-central-1.
Replay `046…107` onto it per `docs/migration-replay-runbook.md` after
fixing the hard-coded project refs listed below (058/088/090/091 would
otherwise make its pg_cron jobs POST to prod edge functions); it already
runs `espn_sync_*` cron jobs pointed at itself. Latency numbers will carry
some cross-region overhead versus a us-east-1 prod; the gates are relative,
so that is acceptable for the college profiles. Replaying 101–107 here also
rehearses the pending prod migrations, 103 included, on a real project
before they are applied to prod.

**B. Create a fresh staging project** as described below. Cleaner, slower
(new project, vault secret, edge-function deploy, Realtime quota request).

Either way the first command afterwards is `npm run load:preflight`, which
must print READY before anything is seeded.

To create a fresh project that can host stages 1–5:

- New project in `us-east-1` (same region as prod) on the Pro org. Stages
  1–3 fit the Micro compute; stages 4–5 need Small or Medium (hourly billed,
  can be dropped after the run) — the same sizing question the prod plan
  faces for game weeks.
- Replay `supabase/migrations/001…107` per `docs/migration-replay-runbook.md`.
  Before replay, fix hard-coded project refs: `029` and `038` point at the
  dev project, `058`, `088`, `090`, `091` point at prod — on staging their
  pg_cron jobs would POST to prod edge functions. Store the
  `fan_wave_service_role_key` vault secret for the staging project.
- Deploy the edge functions to staging (`supabase functions deploy --project-ref <staging>`).
- Realtime settings to mirror prod: `max_concurrent_users` 10 000,
  `max_events_per_second` 2 500, `max_joins_per_second` 2 500,
  `connection_pool` 2 (ask support to raise; this is the first thing stage
  3 is expected to hit).

## Known unknowns

- `realtime-ws.js` implements the realtime-js v2 wire protocol from
  documentation, not from a captured session. Inspect the first stage-1
  join replies (`console.warn` lines) before trusting its numbers.
- Stage 4–5 HTTP scenarios from one 16 GB machine: k6 uses ~1–2 MB per VU
  on these scripts; 10 000 VUs is borderline. Prefer a cloud VM.
- Prod auth refresh limit is 150 / 5 min / IP. All k6 traffic leaves one
  IP, so any script that refreshed tokens would be throttled in a way real
  users behind separate carrier NATs are not. The scripts therefore never
  refresh; they pre-mint. Venue Wi-Fi (thousands of fans behind one NAT)
  is the real-world case that matches k6's single IP — the P2.12 jitter
  work addresses the client side of that.
