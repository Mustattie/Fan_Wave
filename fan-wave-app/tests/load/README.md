# Load tests (k6)

Signed-in k6 scenarios for the 50k–100k-user World Cup / game-week prep.
Everything here targets a **staging** Supabase project. `lib/config.js`
throws in the init context if `SUPABASE_URL` or the key is the production
project (`fwlfiejvxmslkpoojggs`), so no script can start against prod.

> **Status (2026-10-02):** still **not run**. There is no staging project
> the scripts can use today: both EAS profiles and `.env.staging` point at
> prod, and the legacy dev project `azkmymxdjylmkytrvyfn` ("Fan Wave",
> ACTIVE_HEALTHY, Postgres 17.6, ca-central-1) stopped at migration 045 of
> 107 — a read-only probe on 2026-10-02 found no `watch_parties.venue_metro`,
> no `trending_clips` view, no `users.subscription_tier`, no `get_user_tier`,
> and only `games` in the realtime publication, so `home-screen.js` and
> `spike-test.js` would 400/404 against it. k6: not on PATH on the dev
> PC; the preflight also accepts a portable copy
> (`%LOCALAPPDATA%\FanSphereTools\k6\k6-v<ver>-windows-amd64\k6.exe`) or
> a `K6_BIN` path. A 2026-10-02 Codex review reports a portable v2.2.0 at
> that location whose production guard exited 107 before sending traffic;
> it was not visible from Claude Code's Bash or PowerShell sessions the same
> day, so run `npm run load:preflight` and trust its "k6 ... via" line
> (or set `K6_BIN` to the exact path). Ready now:
> the college-launch profiles below, the requirements
> manifest, and `npm run load:preflight`, which proves a target is
> non-production and complete before any k6 process starts. See "Standing
> up staging" for the two unblock paths.

## Scripts

| Script | What it measures | Needs |
| --- | --- | --- |
| `home-screen.js` | Screen-open feed: games + parties near city + public groups + clips page 0 | — |
| `spike-test.js` | Kickoff spike: baseline → stage peak in 10 s, hold, cool down; read mix | — |
| `chat-send.js` | `check_rate_limit` + `messages` INSERT, one room | `CHAT_ROOM_ID` (public room) |
| `watch-party-rsvp.js` | `rsvp_to_watch_party` going→none burst on one party | `PARTY_ID` |
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

Thresholds are the stage-gate rules below, unchanged: they are per-request
latencies and error rates, so they do not loosen for a smaller audience.

| What must hold | Gate | Script |
| --- | --- | --- |
| Each screen-open query (games, parties, groups, clips) | p95 < 800 ms | `home-screen`, `spike-test` (hold phase) |
| Spike phase (the 10 s burst) | p99 < 5 s; p95 reported, not gated | `spike-test` |
| Chat send (`check_rate_limit` + insert) | p95 < 1 s, p99 < 3 s | `chat-send` |
| RSVP toggle | p95 < 1 s | `watch-party-rsvp` |
| Non-rate-limit errors | < 1 %; k6 aborts the run once it has been over the line for 60 s (stop rule) | all |
| Socket connect errors / join success / rejoin within 10 s | < 0.5 % / > 99 % / ≥ 99 % | `realtime-ws` |
| Rate-limit refusals (`rate_limited`, HTTP 429 from migration 103) | reported, not an error; `chat-send` stays under the 60/min ceiling by design, so any 429 there is a server finding | all |

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
| `errors` | < 1 % | all |
| `ws_connect_errors` | < 0.5 % | realtime-ws |
| `ws_join_ok` | > 99 % | realtime-ws |
| `ws_rejoin_within_10s` | ≥ 99 % | realtime-ws |

`rate_limited` (429 / mig 103 ceilings) is reported separately and is not an
error: a run that is throttled by design tells you the ceilings work; a run
that is throttled unexpectedly tells you a ceiling is too low for the
target user count.

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
