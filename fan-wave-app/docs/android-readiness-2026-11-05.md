# Android readiness — 2026-11-05

The owner asked where Android stands and whether the screenshots and the rest
are ready for submission.

**Short answer: Android is not ready for submission, and the live listing is
in worse shape than the iOS one was.** Read from the Play Developer API with
the
`fan-sphere-play-submitter` service account via a temporary edit, discarded
without committing. Backup at
`qa/evidence/2026-11-05/play-listing/pre-change-backup.json`.

## The live listing is still selling the tournament

Production is **versionCode 5**, status completed — live and public. Its
store text reads, today:

- **Short description:** "Live sports watch parties, fan groups & clips.
  **Built for World Cup 2026**"
- **Full description** includes a `🌍 BUILT FOR WORLD CUP 2026` section
  promising "Group-stage tracking, knockout brackets, country-by-country fan
  rooms, and live match coverage", and a `⭐ FAN SPHERE PASSES` section
  offering "**World Cup Pass — $19.99 one-time, unlocks the World Cup tab for
  the full tournament**" and "Pro — full-season premium (coming soon)".

Every one of those is gone from the app. The World Cup tab, the brackets, the
country rooms and the $19.99 pass do not exist, and "Pro" never did. The four
products the app actually sells — $4.99 / $34.99 Home Team, $14.99 / $99.99
MVP — are not mentioned anywhere.

This differs from iOS in a way that matters. The iOS listing was attached to a
version that had never been approved, so nobody ever saw it. **This one is
live.** It is advertising removed features and a withdrawn product to real
visitors.

## Track state

| Track | versionCode | Status |
|---|---|---|
| production | **5** | completed |
| alpha | 6 | completed |
| beta | — | empty |
| internal | 2 | completed |

The next upload must exceed **6**, not 5 — that is the minimum established by
these tracks, so check the full upload history and the EAS remote counter
before choosing the actual number.

## Assets: all stale, none ready

| Asset | Count | State |
|---|---|---|
| phoneScreenshots (en-US) | 6 | tournament-era, must be replaced |
| sevenInchScreenshots | 6 | tournament-era — replace or remove |
| tenInchScreenshots | 6 | tournament-era — replace or remove |
| featureGraphic | 1 | mandatory asset; needs checking for tournament wording |
| icon | 1 | present |

No Android captures exist from any current build, and no current Android build
exists to capture from.

## No Android binary of this source exists

- The newest Android artifact on record is the **internal preview APK,
  versionCode 35**, from commit `57cf4e6`, completed 2026-10-06 — before the
  PR 21 merge, so it carries none of the twenty UAT fixes, none of the
  tournament removal and none of the reviewer-access fix.
- `build.production.android.image` is **still `"latest"`** — I re-checked
  today, nothing pins it. That is the moving alias that destroyed iOS build
  38.
- No Android build has been started. There have been no commits since
  2026-11-03.

So Android is three steps behind iOS: no pinned image, no build, no captures.

## What Android needs, in order

1. **Pin `build.production.android.image`** — one reviewed line. Codex's lane.
   This does not wait on anything; it precedes the build.
2. **Build Android from equivalent application source to the iOS candidate.**
   The image pin is itself a commit, so the two artifacts will not share an
   exact SHA — record the equivalent product source and the configuration-only
   difference rather than claiming one commit. That is what makes the two
   platforms the same product rather than two products sharing a name.
3. **Replace the listing text.** Codex prepared a replacement in
   `docs/play-listing-replacement-2026-10-27.json` on 2026-10-27; it has never
   been uploaded. It needs re-checking against the app as it will ship, then
   committing to the listing.
4. **Capture the six phone screenshots** — our chosen set, not Google's
   minimum, which is two across device types — from the new build. Claude can do this on
   the emulator here — `adb` and two AVDs are installed — but a production AAB
   cannot be `adb install`ed, so it needs an APK generated from the bundle
   with the bundletool already on this machine, or a Play-track install.
5. **Decide the tablet sets.** Six 7-inch and six 10-inch captures are live
   and stale. Removing them carries no documented publication penalty but
   costs tablet merchandising. Replacing them means genuine tablet captures.
6. **Feature graphic** — check and likely redo.
7. **Target API level** — a build requirement, settled before the build, not
   a form.
8. **Data safety form and the contacts declaration** — the latter because
   `READ_CONTACTS` is genuinely used by the invite flow, and Google began
   showing declaration prompts in September 2026.
9. **Merged-manifest inspection** on the new AAB, for `READ_MEDIA_IMAGES` and
   `READ_MEDIA_VIDEO`, before deciding anything about the legacy storage
   permissions.

## What can move before a build exists

More than I first wrote. Only the capture steps truly wait on a binary. The
image pin, the target-API decision, the tablet decision, the feature graphic,
the listing text preparation, and the product and configuration audits can all
proceed now.

**The listing rewrite is the highest-value of those — and it has a trap in
it.** Production is still serving **versionCode 5**, a June binary. Publishing
text that advertises Home Team and MVP would describe a product the currently
installable app may not offer, replacing one mismatch with another. So the
replacement text has to be checked against *the binary users can install
today*, not only against the app as it will ship. If the two cannot be
reconciled, the honest interim move is to strip the tournament claims without
advertising the new subscriptions, and do the full rewrite when the new
binary goes live.

It is held pending the owner's go-ahead because the change is consequential
and outside what has been authorised so far — not because it publishes
instantly. A committed Play edit submits changes for review and leads to
publication depending on the app's publishing state and whether managed
publishing is enabled; it is not a guaranteed immediate flip. The backup above
is the rollback source.

## Honest comparison with iOS

iOS is **much** closer: build 40 is selected on the version, the version is in
PREPARE_FOR_SUBMISSION, the metadata is clean, prices are verified and the
Home Team sheet is confirmed rendering on device.

It is not, however, "only waiting on screenshots". Codex's reading of the
remaining iOS gates, which I agree with:

- Original-resolution captures, the missing and dirty screens, and party
  content confirmed visible to the capture account
- All four plan captures, including MVP, which has never been exercised
- An actual sandbox purchase, entitlement persistence, restore and the MVP
  upgrade, verified on an ordinary account without reviewer access — the
  success screenshot does not establish a transaction
- Footage rights resolved, and a visual check of the submitted app against the
  5.2.1 objection
- Outstanding physical-device acceptance: playback, chat, RSVP, push
- The collapsed 2026-06-11 Apple message read, the rejection response and
  app-level notes finished, and agreements, availability, offering mappings,
  trial configuration, private review images and the actual submission items
  all verified
- The agreed release hold preserved

Those are finite, and nothing in evidence says another iOS build is required —
though rights clearance or an acceptance failure could change that.

Android, by contrast, still needs a pinned image, a build, a listing rewrite,
six captures, a tablet decision, a feature graphic, a target-API decision and
two compliance forms. "iOS is close, Android is further behind" is fair.
"iOS only needs screenshots" is not.
