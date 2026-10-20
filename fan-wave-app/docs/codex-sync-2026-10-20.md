# Xcode image fix and TestFlight retry — 2026-10-20

The owner explicitly approved applying the prepared Xcode 26.6 image fix, retrying the paid build and uploading the successful candidate to TestFlight.

- Applied only `build.production.ios.image`: `latest` → `macos-tahoe-26.5-xcode-26.6`.
- Commit `d77e89f11c9d986ba731a21b27a72fb0f7198f79` pushed to v9.5 and remote hash verified.
- JSON parse, exact before/after object comparison and Git whitespace checks passed. No runtime source or dependency changes, so the passing 389 iOS / 387 Android tests from October 19 remain the product-code gate.
- Reused the clean isolated managed build checkout; left the separate untracked October 17 investigation note untouched.
- Build 39: `b2dd9155-31c6-4b1d-b231-28f78e8842f8`, source d77e89f. The builder log confirms `macos-tahoe-26.5-xcode-26.6`, Xcode 26.6 (17F113).

Build: https://expo.dev/accounts/dataking263/projects/fan-wave-app/builds/b2dd9155-31c6-4b1d-b231-28f78e8842f8

The prior backend rollout remains recorded in `qa/evidence/2026-10-19/uat-rollout/verification.json`. No additional backend change is part of this retry. The earlier build 38 failed and was never uploaded to Apple.

Build completion, artifact checks and Apple processing/group availability will be recorded below. Physical-device acceptance is pending; no App Store review submission or public release is authorized.

## Completed

Build39 finished successfully and IPA identity/profile/production push entitlement checks passed. Bundle contains the production backend URL and a usable production Sentry DSN. SHA256: `9e16b6c1f9b09ec939e102f622f67c3d71691392c1c963f8caea07ad0959f6b0`.

EAS submission `230a0be7-0174-4249-be19-45b5e7981e99` succeeded. Apple build `e51bb27e-6377-48ef-bdfa-405d5d8a0526` is VALID and IN_BETA_TESTING, with encryption exempt. Verified available in the existing internal Outside Testers group; targeted English What to Test notes attached. No new testers invited, beta review submission, App Store review submission or public release.

All20 implementation issues received TestFlight delivery comments; no issue closed. Physical-device retest remains the next acceptance gate. SKYC-134/138 investigations remain outside the implemented fixes. Evidence: `qa/evidence/2026-10-20/testflight/verification.json`.

TestFlight: https://appstoreconnect.apple.com/apps/6774325670/testflight/ios

## Claude hand-off — 2026-10-20

Added after build 39 was uploaded. Nothing here touches build 39 or the
acceptance gate; the owner approved all three items.

### 1. SKYC-147 filed for the build-37 sign-out

The finding in [the 2026-10-17 note](codex-sync-2026-10-17.md) now has a
ticket: **SKYC-147**, Medium, no sprint. `auth.unexpected_signed_out` (5
events) and `auth.refresh_failed` (4) are the only events iOS build 37 ever
produced, and the sign-out event's last breadcrumb is a
`POST grant_type=refresh_token` returning 400 while `feature_flags` reads
return 200 around it. Filed as a finding, not a defect: a 400 on a refresh
grant is also normal token rotation or reuse, so it needs a tester
confirmation or a recurrence before any auth code changes.

**Watch for it during build 39 UAT with `build_number:39 platform:ios`.** The
`platform:ios` term is required — `org.fansphere.app@1.0.0+39` already exists
as an **Android** versionCode 39 from 2026-10-06, so the release string alone
commingles two different builds.

### 2. Still open in Codex's lane: one read-only production query

From the 2026-10-17 note, not yet answered, and the 2026-10-19 rollout had
production access:

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'invoke_team_logo_sync';
```

The repository shows migration 038 creating that function against the legacy
project `azkmymxdjylmkytrvyfn`, no later migration editing it, and the
`espn_sync_team_logos` cron recorded active at `0 9 * * 1`. **If** production
still holds that body, the weekly logo refresh has been posting to the wrong
project since 2026-06-09 — but that conclusion needs the readback above plus
some execution evidence (a `net.http_response` row or a run log), neither of
which the repository can supply. Since `sync-game-schedules` only inserts teams
it cannot match and never updates `logo_url` on an existing row, a wrong logo
in production would then have no way to heal itself. The program ledger already
lists 038's hard-coded reference as a staging-replay obstacle; this is the
separate possible production consequence. Please also capture the matching
`cron.job` command.

No fix is proposed here, and nothing about it is urgent either way.

### 3. SKYC-137: the 2026-10-19 sync partially answered its open question

The remediation plan deferred "check whether the stored World Series rows are
actually reached by a sync run". The authorized production MLB sync reported
`upserted: 0, skipped: 10`, and in `sync-game-schedules` `skipped` means the
stored row already matched what would have been written. That is an aggregate
count with no row identities, so it does **not** establish that the World
Series rows in question were among the ten, and it does not predict future
runs: `gameTimeForWrite` still clears a stored timestamp when ESPN reports the
time as explicitly unknown. All it says is that ten MLB rows the sync did reach
needed no change. The specific-row question stays open and wants a read of
those rows; still no backfill proposed.

### 4. Branch for the build after 39, not for this one

`claude/logo-recycling-and-clip-stall-telemetry`, off `v9.5` at `9edecf8`.
Two client changes, both from the 2026-10-17 investigation, both held out of
build 39 deliberately so that candidate stays byte-identical to the reviewed
source:

- **`components/TeamBadge.tsx` (SKYC-138).** Core RN `<Image>` with no key →
  expo-image with `recyclingKey={team.logoUrl}`, which is how the Clips feed
  already guards its posters. Plus the independent defect in the same file: the
  `logoFailed` boolean never reset when `team.logoUrl` changed, so one failed
  load suppressed the logo for every team that instance was later handed. It is
  now a `failedUrls` set, so each URL keeps its own verdict — a badge cycling
  A → B → A does not retry A's broken logo because B failed in between (Codex
  round 1 caught that the first version tracked only the latest failure).
- **`app/(tabs)/clips.tsx` (SKYC-134).** The 15-second stall verdict was the
  only one of the three paths to "Couldn't load this video" that reported
  nothing, so an empty Sentry search read as "did not reproduce". It now emits
  `clips.player_stall` with the clip id and a `clip_stall_phase` tag of
  `initial` or `retry`. Telemetry only — no playback behavior changed, and no
  speculative fix for 134.

`__tests__/teamBadgeRecycling.test.tsx` pins both TeamBadge behaviours (6
tests). The clips change has no test: it is a telemetry call inside a
`setTimeout` in a screen component with no existing render harness, and the
three existing clips suites are unit tests over `lib/`. Gate results are
recorded in the commit body.

Neither change is a candidate for closing SKYC-134 or SKYC-138. 138's fix still
wants the device check from Jira comment 11258 to confirm the recycling window
was the mechanism rather than a wrong `logo_url` in the data, and 134 is
unchanged in behavior — the instrumentation exists so the *next* run produces
evidence either way.
