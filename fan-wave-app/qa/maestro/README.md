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
| `10_signup_paywall_gate.yaml` | Hotfix A | Sign-up routes to verify-email; post-onboarding routes to Choose Plan (not tabs) |
| `11_location_detection.yaml` | Hotfix B | Detect-my-location returns real city or surfaces permission-denied; Chicago is NOT first in Popular Cities |
| `12_unverified_blocked.yaml` | Hotfix C | Unverified user attempting sign-in sees "Email not verified" alert + Resend button |
| `13_clips_ownership_delete.yaml` | Hotfix D | Clips feed shows own clip with visible Delete button; delete confirmation removes it |

## Hotfix scenarios (10–13)

These four scenarios were added on 2026-06-09 to pin down the production
P0 bugs the same-day hotfix ships fixes for. Run them all before pushing
the hotfix build to closed testing:

```
maestro test fan-wave-app/qa/maestro/10_signup_paywall_gate.yaml
maestro test fan-wave-app/qa/maestro/11_location_detection.yaml
maestro test fan-wave-app/qa/maestro/12_unverified_blocked.yaml
maestro test fan-wave-app/qa/maestro/13_clips_ownership_delete.yaml
```

Or run the full hotfix suite in one shot:

```
maestro test fan-wave-app/qa/maestro/1[0-3]_*.yaml
```

Or run ALL Maestro scenarios:

```
maestro test fan-wave-app/qa/maestro/
```

### Hotfix prerequisites

1. **Maestro CLI installed** — verify with `maestro --version`. Install via:
   ```
   iwr -useb https://get.maestro.mobile.dev | iex   # PowerShell
   ```
2. **`ANDROID_HOME` set** so `adb` is on PATH. From PowerShell:
   ```
   echo $env:ANDROID_HOME
   ```
   should print the Android SDK path (commonly `C:\Users\<you>\AppData\Local\Android\Sdk`).
3. **An Android emulator booted + visible to adb** — confirm with `adb devices`. Should list one entry like `emulator-5554 device`.
4. **Fan Sphere APK installed on the emulator** — sideload the latest hotfix APK from EAS, or run `expo start --android` against a dev build.
5. **Scenario 10 + 12** use generated fresh emails per run (via `${maestroRunId}`); no pre-provisioning required.
6. **Scenario 11** assumes an account that's past sign-up but BEFORE onboarding-city completion. If you're using a fully-onboarded test account, the scenario will short-circuit on the `assertNotVisible: "Today's Games"` guard.
7. **Scenario 13** signs in as `fansphere.reviewer@gmail.com` (the canonical reviewer account — see project memory note `reference_test_account`). That account MUST have at least one own clip seeded; if the Clips feed is empty for the reviewer, the `assertVisible: "Delete"` check will fail.

### What each hotfix scenario guards

- **10 — Signup paywall gate**: catches regressions where (a) sign-up bypasses the verify-email screen, or (b) post-onboarding lands the user directly in tabs instead of the Choose Plan paywall. Asserts on the visible plan strings ("Monthly" / "$9.99" / "Annual" / "$107.88") instead of the spec wording ("Premium Monthly $9.99") because the on-screen text in `app/(auth)/choose-plan.tsx` uses the shorter labels. The "World Cup 2026 Pass" string lives on the next screen (`wc-pass-offer.tsx`) and is covered by scenario 08.
- **11 — Location detection**: catches regressions of the "Chicago fallback" bug. Cannot assert a specific resolved city (depends on emulator GPS) but pins that the detect button MUST either resolve a real city or surface the permission-denied error — never silently default to Chicago. Also pins that the Popular Cities pills render in alphabetical order with Atlanta first.
- **12 — Unverified blocked**: signs up a fresh user, then attempts to sign in without confirming the email. Asserts the "Email not verified" alert with "Resend" + "OK" buttons. This is the client-side half of the verify-email regression guard; the server-side half is enforced by the Supabase "Confirm Email" setting.
- **13 — Clips ownership + delete**: signs in as the reviewer, navigates to Clips, asserts the Delete button is visible (proving `isOwner` is wired correctly), then confirms the delete dialog removes the clip. Guards against both the "test clips leak" regression and the "missing delete button" regression.

### Selector + reliability notes

- All four scenarios follow the existing project conventions:
  - `extendedWaitUntil` with explicit `timeout` for any cross-screen transition
  - `waitForAnimationToEnd` after every navigation tap
  - `takeScreenshot` at every interesting frame so reviewers can triage from artifacts
  - `optional: true` on taps that may or may not surface depending on the device state (e.g. system permission prompts, alert OK buttons)
- The sign-up scenarios use `fansphere.qa+hotfix-${maestroRunId}@gmail.com` and `fansphere.qa+unverified-${maestroRunId}@gmail.com` so each run gets a unique email and never collides with prior runs. Supabase will receive the `+`-tagged addresses but bounce them to the underlying `fansphere.qa@gmail.com` inbox if you want to inspect.
- Real email-link verification can't be automated inside Maestro. For scenario 10's post-verify branch, pre-confirm the user in Supabase Studio (Authentication → Users → "Confirm user") before running, or tap the link in the QA inbox manually.


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
