# Store asset capture requirements — iOS and Android, 2026-10-27

The owner asked what to request from the friend holding the physical iPhone,
and what the Android equivalent is. This checks Codex's capture list in
`store-refresh-2026-10-27.md` and splits the work by who can actually do it.

Codex reviewed this and verified every store specification below against
Apple's and Google's current documentation; it corrected five claims in the
first draft, recorded at the end.

## Can Claude just do this?

The limits are authorization and tooling on this machine, not anything
intrinsic — worth stating precisely so the split is accurate.

| Task | Claude | Why |
|---|---|---|
| iOS screenshots | **No** | Windows machine, no iOS simulator, no iPhone attached. The friend is the available route; a Mac with a simulator would be another. |
| Android screenshots | **Yes, once there is an installable artifact** | `adb` verified at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`; AVDs `Fan_Sphere_UAT` and `Medium_Phone` installed; nothing attached right now. Emulator captures are acceptable to Play. |
| Upload to ASC / Play | **No** | Owner-owned console work; Claude's production access is blocked. |
| Build either platform | **No** | Paid EAS builds are Codex's lane. |
| Source and config changes | **Yes**, with Codex review | Normal workflow. |
| Seed demo content | **Partly** | Ordinary in-app actions on the Android emulator are possible once a build is installed. Production data seeding is not. |

**The friend is unavoidable for iOS.** For Android I can do the captures here.

## Store specifications, verified

**Apple — iPhone screenshots.** Uploads must match an accepted pixel size.
Apple's current table accepts, in portrait (landscape reverses):

| Display class | Accepted pixels |
|---|---|
| Dynamic Island, large | 1260×2736, 1290×2796, 1320×2868 |
| Face ID, large (includes the former 6.5-inch) | 1242×2688, 1284×2778 |
| Dynamic Island, medium | 1179×2556, 1206×2622 |
| Face ID, medium | 1080×2340, 1125×2436, 1170×2532 |
| Home Button, large | 1242×2208 |

1–10 screenshots per size, JPEG or PNG, no transparency. Apple's published
**required** iPhone class is **Dynamic Island, medium**, with the documented
scaling fallbacks covering the rest. **The former 6.5-inch sizes are still
accepted.** Confirm which wells App Store Connect actually marks required
before assuming one set covers the submission.

**Google Play.** A minimum of **two screenshots across device types**, and up
to **eight per device type** — not a flat two-phone minimum. JPEG or 24-bit
PNG without alpha, each dimension 320–3840 px, longest side at most twice the
shortest. Feature graphic **1024×500** is **mandatory**. Listing icon
**512×512** is a separate required asset. For screenshot-based promotional
eligibility, supply **four screenshots at 1080×1920 portrait or 1920×1080
landscape** or larger — worth setting the emulator to those dimensions. Preview videos are optional; alt text is
available and worth filling in.

**Emulator captures are acceptable** for Play. Capture the app only — no
emulator controls, no desktop chrome.

**TestFlight transacts against Apple's sandbox automatically.** Testers are
not charged and no separate sandbox Apple Account is needed for ordinary
testing.

## What Codex's list gets right, and what it leaves open

The six marketing screens and four private purchase captures are the right
asks, and the attached constraints — native status bars, full original
resolution, no notification or keyboard overlays, real data, unedited
originals — are all correct and all previously violated.

Four things to add:

1. **Ask the friend for iPhone model and iOS version — for planning, not as a
   gate.** The first draft of this note claimed a non-matching device makes
   captures unusable. That was wrong: most modern iPhone native resolutions
   appear in the table above, and Apple scales between display classes. Knowing
   the model tells us which well the captures land in and whether a second
   size is wanted. What is still true: do not distort or letterbox a capture
   to fake a size it was not taken at.
2. **Final captures wait for the replacement build; preparation does not.**
   Account setup, the walkthrough, content checks, emulator preparation and
   the feature graphic can all start now.
3. **The four purchase captures are paywall screenshots, not completed
   purchases.** Taking them does not require four transactions. They are
   per-product review assets and must be attached to the right products in
   App Store Connect, not merely described in review notes. Purchase and
   restore validation is a separate check.
4. **Content checks, more precisely than "seed everything".** Home falls back
   to all games when there are no interest signals
   (`app/(tabs)/index.tsx:74`), and Game Day has an unfiltered fallback too,
   so a followed sport is not strictly required. What genuinely needs
   verifying before capture: that games exist on the day, that a watch party
   is visible by timing, location and access, that the account is in a group
   with chat content, and that **Clips** has a playable licensed clip —
   screen 4 is the one most likely to come out wrong, since a dark or loading
   frame is exactly what the last set showed.

## What to ask the friend for — iOS

**Now:** iPhone model and iOS version.

**When the build is on TestFlight**, install it and capture from the app, no
editing afterwards:

| # | File | Screen | Make sure |
|---|---|---|---|
| 1 | `01-home.png` | Home | Games and ideally a nearby watch party visible |
| 2 | `02-discover.png` | Discover | Fan groups listed |
| 3 | `03-game-day.png` | Game Day | Live, upcoming or final games present |
| 4 | `04-clips.png` | Clips | A licensed clip **playing** — not dark, not loading |
| 5 | `05-watch-party.png` | Watch party detail | Attendees visible |
| 6 | `06-group-chat.png` | Fan group chat | **No private messages legible** |

Plus four **private** purchase-review captures — Home Team Monthly, Home Team
Annual, MVP Monthly, MVP Annual — each showing the plan name, store-loaded
price and period, disclosures and call to action. Never published as
marketing images.

**Rules to pass on verbatim:** screenshots only, no recordings. No cropping,
resizing, device frames or status-bar editing. Silence notifications first.
Send the original files and we will verify dimensions on arrival — compression
depends on how they are sent, so sending as files rather than inline images is
the safe habit.

If the paywall sheets open without prices, that is a defect to report, not to
photograph. It is the same failure mode as the 2.1(b) rejection.

## Android — the equivalent

Same six screens from the final Android build, captured here. Then:

- **Feature graphic 1024×500** — mandatory, and the current one may carry
  tournament wording. A design asset to produce, not a capture.
- **Listing text** — live en-US short and full descriptions still advertise
  World Cup 2026, a $19.99 pass, brackets and a dedicated tab. Replacements
  are prepared in `docs/play-listing-replacement-2026-10-27.json`, not yet
  committed to Play.
- **Audit every other asset**: the 512×512 icon, all localized sets, any
  promotional assets, for stale tournament material.
- **Tablet screenshots — a decision.** Six 7-inch and six 10-inch captures are
  live, all tournament content. Removing them carries no documented
  publication penalty, but it does reduce tablet merchandising and weakens the
  listing for tablet users. Note that iOS `supportsTablet: false` says nothing
  about Android tablet support — that inference in the first draft was wrong.
- **Data safety form** — and distinguish the manifest permission from a
  collection disclosure. `READ_CONTACTS` is genuinely used: `expo-contacts`
  backs the invite flow at `app/(tabs)/discover.tsx:805` via
  `lib/inviteContacts.ts:21`. But contacts processed only on-device are not
  automatically "collected"; trace whether anything leaves the device before
  completing the form.
- **Target API level** currency, and **versionCode above 6** — production is
  at 5 but alpha is at 6.

**Handoff detail that will otherwise bite:** production Android builds are
**AABs**, and `adb install` cannot install one. Either install from a Play
track, or generate an APK from the bundle with the bundletool already on this
machine. Do not silently substitute the staging preview build for the
production artifact.

## The storage permissions — check, don't assume

`app.json` declares `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`.

The first draft called them "probably unnecessary" and dismissed the risk on
the grounds that Play already approved a build carrying them. Codex disputed
both, correctly:

- `WRITE_EXTERNAL_STORAGE` stops granting additional access for apps targeting
  **API 30 (Android 11)** — not API 29 as first written.
- The app does request media-library permission before several flows,
  including the clip export at `lib/clipExport.ts:42`, so the picture is not
  simply "unused legacy".
- `expo-image-picker` and `expo-media-library` declare these permissions in
  their own manifests, so **removing the entries from `app.json` may not
  remove them from the merged manifest**.
- Previous approval does not establish that the next submission is compliant.

**So the action is an inspection, not an edit.** Before submitting, dump the
replacement AAB's merged manifest and look at what is actually declared —
particularly `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO`, which are what Play's
photo and video permissions policy is aimed at. Decide from that, not from
`app.json`.

**Contacts policy — check whether it touches this release.** Google's contacts
policy enforces from **2027-01-27 for apps targeting Android 17 / API 37+**,
requiring the system picker where broad contacts access is not necessary. That
part is a future ticket. But Google began showing **declaration prompts in
September 2026**, so whether this submission has to answer one depends on the
replacement build's target API and on what the console asks at upload. Check
it rather than assuming it is deferred — it affects the invite flow in
`app/(tabs)/discover.tsx`.

## Sequence

1. Ask the friend for model and iOS version — today.
2. Verify the capture account has usable content; produce the feature graphic;
   prepare the emulator. All startable now.
3. Codex builds both platforms from one commit.
4. iOS to TestFlight → friend captures → sends originals → dimensions verified
   on arrival.
5. Android: generate an installable APK from the bundle, capture here.
6. Owner uploads both sets, swaps the Play listing text, decides the tablet
   question, and attaches the four per-product review images in ASC.

## Review record

Codex verified the Apple and Google specifications above against current
documentation and corrected five claims in the first draft: that the friend's
iPhone model was an absolute blocker and that scaling would breach 2.3.10;
that iOS `supportsTablet: false` implied anything about Android tablets; that
`WRITE_EXTERNAL_STORAGE` lost effect at API 29 and that prior approval made
the permission question non-blocking; that the six screens would render empty
without seeded interests, when Home and Game Day both have unfiltered
fallbacks — while noting the first draft omitted Clips, the screen most at
risk; and that Claude "cannot" do several tasks, when the real constraint is
authorization and local tooling. It added the 512×512 icon, alt text, the
AAB-versus-`adb install` handoff, the per-product attachment point for the
review images, the merged-manifest inspection, and the 2027 contacts policy.

Codex could not reach the Android SDK executables from its own session; the
`adb` path and AVD list above were verified from this one.
