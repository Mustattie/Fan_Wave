# Fan Sphere Maestro QA Scenarios

End-to-end UI test scenarios for [Maestro](https://maestro.mobile.dev/). These run against the Android emulator and exercise the same code paths a real beta tester would hit — sign-up, onboarding, fan groups, World Cup tab, watch parties, clips, and the paywall flow.

## Why these exist

We need defensible evidence of multi-day, multi-feature testing for App Store / Play Store review. Real human beta testers cover the "real user signal" axis. These Maestro scenarios cover the "engineering rigor" axis — same code paths, screenshots per step, deterministic pass/fail.

See `C:\Users\tmusa\.claude\plans\rosy-jumping-chipmunk.md` for the full plan.

## Setup (one-time)

1. **Install Maestro** (Windows PowerShell):
   ```
   iwr -useb https://get.maestro.mobile.dev | iex
   ```
   Restart your shell, then verify: `maestro --version`

2. **Start an Android emulator** via Android Studio AVD Manager. Confirm:
   ```
   adb devices
   ```
   Should list one running emulator.

3. **Install the Fan Sphere app** on the emulator. Options:
   - Sideload the production AAB/APK (download from EAS build artifacts page)
   - OR run `expo start --android` from `fan-wave-app/` with a dev build installed

4. **Create a QA Gmail** (e.g. `qa.fansphere.android@gmail.com`). Add it to the Play Closed Testing tester list so install metrics count.

## Running a scenario

From repo root:
```
maestro test fan-wave-app/qa/maestro/01_signup_onboarding.yaml
```

Or run all scenarios sequentially:
```
maestro test fan-wave-app/qa/maestro/
```

Maestro writes screenshots + reports under `~/.maestro/tests/<timestamp>/`.

To save artifacts into the repo (for git audit trail), pass `--format=junit --output=output/`:
```
maestro test fan-wave-app/qa/maestro/01_signup_onboarding.yaml --format=junit --output=output/2026-06-01/01_signup_onboarding/
```

## Scenarios

| File | Day | Coverage |
|---|---|---|
| `01_signup_onboarding.yaml` | D1 | Sign up + onboarding (sports/teams/city) + tour 6 tabs |
| `02_fan_group_create.yaml` | D2 AM | Create a new fan group |
| `03_fan_group_join_participate.yaml` | D2 PM | Join existing groups, chat, post clip from inside group |
| `04_world_cup_tab.yaml` | D3 | World Cup tab — schedule, matches, bracket, WC group, WC parties |
| `05_watch_party_rsvp.yaml` | D4 AM | Browse + RSVP to existing watch parties |
| `06_watch_party_create.yaml` | D4 PM | Create your own watch party for a WC match |
| `07_clips.yaml` | D5 | Clip upload, like, share, export |
| `08_paywall_probe.yaml` | D6 | Premium + WC Pass paywalls (cancel at purchase dialog) |
| `09_daily_engagement.yaml` | D7–D14 | Sustained daily light engagement |

## Boundaries

- Scenarios run against the **production Supabase + RevenueCat sandbox**. The QA tester is registered in the `beta_testers` table with `recruited_via='automated_qa'` so it can be filtered out of reviewer-facing exports.
- The paywall probe (08) **always cancels before completing a real purchase**. We only need the `purchase_events` row triggered by reaching the dialog.
- Each scenario should complete in under 5 minutes. Anything longer is a selector regression.

## Selector strategy

The Fan Sphere app currently has no `testID` props on its components. These scenarios use text-based selectors (`tapOn: "Sign Up"`) which are more brittle but require no code changes. If a selector starts failing because button text changed, update the YAML rather than rebuild the app.

For future-proofing: when we add `testID` props during a regular refactor, scenarios can be migrated to `tapOn: "id:signup-button"` for stability.

## Troubleshooting

- **"App not found"** → check `appId` matches `org.fansphere.app` (in each YAML's header)
- **"Element not visible"** → run with `--debug-output=./debug` and inspect the dumped view hierarchy
- **Scenario hangs on launch** → the cold-start animation can take 10+ seconds on a fresh emulator. Increase `LAUNCH_TIMEOUT` env var.
