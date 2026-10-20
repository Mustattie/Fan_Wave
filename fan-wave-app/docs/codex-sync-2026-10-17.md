# Codex / Claude sync — 2026-10-17: the two un-reproduced tickets, and a new auth finding

Resumed from [the 2026-10-16 note](codex-sync-2026-10-16.md). Nothing in the
rollout moved today, because everything left in it needs hosted access Claude
does not have. What follows is source and telemetry work that did not need it.

## Rollout state, unchanged from 2026-10-16

| Gate | State |
| --- | --- |
| PR21 → `v9.5` | merged at `5f9dcf1`; `origin/v9.5` = `e76f705`, working tree clean |
| Staging | migration 109 applied; venue-search v1, schedule-sync v10 deployed |
| **Blocker** | staging has no `GOOGLE_PLACES_API_KEY`, so venue provider/quota cannot be verified |
| Production | migration 109, function updates: **not applied** |
| Build | no TestFlight candidate carrying the fixes |
| Jira | 20 In Progress, 2 To Do (134, 138), 1 Done (126) — readback 2026-10-17 |

Prior owner approval for merge + migration 109 + the two function updates + a
new TestFlight candidate still stands, excluding App Store review and manual
production cleanup. Resume at the venue authenticated/provider/quota gate once
a Places key is installed in staging.

## SKYC-138 — mechanism identified, no fix applied

Full detail in Jira comment 11258. Short version:

- Home and Game Day use byte-identical selects (`hooks/useData.ts:63`,
  `lib/homeGameQuery.ts:13`), the same mapper and the same `GameCard`, so
  neither query shape nor mapping can explain the reported difference. Caching
  is not excluded: the two screens keep independent AsyncStorage entries
  (`['games', 50]` vs `home-<lo>-<hi>`), so they can render snapshots written
  at different times. A 30-second TTL makes that an unlikely explanation for a
  difference that held across two screenshots, but it is not ruled out.
- `components/TeamBadge.tsx:25-35` uses core RN `<Image>` with no `key` or
  `recyclingKey`. A reused instance keeps the previous team's bitmap until the
  new URI decodes. The repo's own remedy for this shape is at
  `app/(tabs)/clips.tsx:286` (`recyclingKey={clip.id}`).
- Independent of the ticket: `logoFailed` (`TeamBadge.tsx:14`) never resets when
  `team.logoUrl` changes, so one failed load suppresses the logo for every team
  that instance is later handed. Provable from source; affects all four call
  sites.

### For Codex's lane — one read-only confirmation

`invoke_team_logo_sync` still posts to the legacy project `azkmymxdjylmkytrvyfn`
(`supabase/migrations/038_schedule_team_logo_sync.sql:17`). Migration 058 fixed
that base URL for `invoke_espn_sync` and left 038 alone; no later migration
touches it; `espn_sync_team_logos` is recorded active on prod at `0 9 * * 1`
(`qa/evidence/2026-10-12/release-backend-parity-20261012.json:27-33`). Since
`sync-game-schedules` only inserts unmatched teams and never updates
`logo_url` on an existing row (`index.ts:536-562`), a wrong logo in prod cannot
heal itself if this is true.

Confirm with `SELECT prosrc FROM pg_proc WHERE proname = 'invoke_team_logo_sync';`
and the matching `cron.job` command. The parity evidence carries only a hash
for that function, so the repository cannot settle it.

## SKYC-134 — the retest instruction was wrong

Full detail in Jira comment 11259. The 15-second stall verdict in
`app/(tabs)/clips.tsx:786-791` and `:958-960` sets the "Couldn't load this
video" state with no telemetry at all, while the other two paths
(`clips:replaceAsync`, `clips:playerStatus`) report. An empty Sentry search is
therefore not evidence of absence — it is the signature of the silent path.

Sentry read (org `fan-sphere`, project `react-native`, `claude-uat-monitor`
token, read-only): `build_number:37` has exactly two issues, both auth; no
`expo-video` or `video` matches in 14 days; no events dated 2026-10-14 at all,
consistent with the UAT run being on simulators with Sentry disabled.

## New: unexplained sign-out on build 37, not in the 23 tickets

Two Sentry issues carry `build_number:37`, `environment production`,
`os iOS 26.6.1`, `device iPhone18,1`, `release org.fansphere.app@1.0.0+37`:

- `auth.unexpected_signed_out` — 5 events, last 2026-10-15T09:44:40Z
- `auth.refresh_failed` — 4 events, last 2026-10-15T09:50:32Z

The sign-out event's breadcrumb trail ends in
`POST grant_type=refresh_token` returning **400 bad request**, and the
`auth.refresh_failed` event shows healthy traffic around it (`feature_flags`
reads returning 200), so this is not a connectivity failure. A 400 on a refresh
grant is also what token rotation or reuse produces, so this is a finding, not
a diagnosis.

No Jira issue covers it — a search over `signed out`, `sign-out`, `session`,
`refresh token` and `logged out` returns only SKYC-81 and SKYC-10, both Done.
Recommend a new ticket; not created, because that is sprint scope and the
owner's call. If the tester was signed out unexpectedly during the 2026-10-15
session, that is the same event and worth asking them about.

## Changed today

Jira comments 11258 (SKYC-138) and 11259 (SKYC-134), and this note. No source,
migration, deployment, build, secret or production change. No ticket closed or
transitioned.
