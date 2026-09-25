# Load tests (k6)

Signed-in k6 scenarios for the 50k–100k-user World Cup / game-week prep.
Everything here targets a **staging** Supabase project. `lib/config.js`
throws in the init context if `SUPABASE_URL` or the key is the production
project (`fwlfiejvxmslkpoojggs`), so no script can start against prod.

> **Status (2026-09-25):** scripts refreshed for v9.5 (per-VU JWTs, real
> RLS-visible queries, Realtime socket scenario, stage profiles, gate
> thresholds). **Not yet run** — there is no staging project. Both EAS
> profiles point at prod, and the legacy dev project `azkmymxdjylmkytrvyfn`
> is schema-stale since June. See "Standing up staging" below.

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
rate-limit taxonomy).

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

1. Install k6 (Windows: `winget install k6 --source winget`; macOS: `brew install k6`).
2. Create `fan-wave-app/.env.loadtest` (gitignored):
   ```
   STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co
   STAGING_SUPABASE_ANON_KEY=<staging anon key>
   STAGING_SERVICE_ROLE_KEY=<staging service_role key>
   ```
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

There is no staging Supabase yet. To create one that can host stages 1–5:

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
