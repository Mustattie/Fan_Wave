# Store cleanup executed — 2026-11-05

The owner authorised removing World Cup imagery and narrative from both
stores and asked for everything to be made ready for submission. This records
what was executed, what was found, and what genuinely cannot be finished yet.

Codex reviewed the Play plan before it was committed and required one change,
noted below.

## What was on the Play listing, and is now removed from it

All six phone screenshots and the feature graphic were downloaded and
inspected individually; one image was sampled from each tablet set. The
findings were worse than the text audit suggested.

**Scope of the claim:** everything below is removed from the **committed
listing**. Public propagation is a separate thing and has not been verified —
see the commit note further down.

| Image | Content | Action |
|---|---|---|
| phone1, phone2 | Onboarding carousel pages 1–2. No tournament content | **Kept** |
| phone3 | Watch-party detail, "England vs Uruguay Big Screen". No tournament wording, but stale and internally contradictory — "45/80 going" above "Attendees (0)" | **Deleted** |
| phone4 | Old Home screen. **Six-tab nav including a World Cup tab**, plus a "Dallas World Cup Crew" group | **Deleted** |
| phone5 | My Groups. "Dallas World Cup Crew", a group tagged "World Cup", same six-tab nav | **Deleted** |
| phone6 | The World Cup tab itself — header "World Cup 2026 · USA · Canada · Mexico", body text reading **"FIFA World Cup 2026"**, a countdown, Group Stage / Round of 32 / Round of 16 chips, country flags | **Deleted** |
| 7-inch × 6, 10-inch × 6 | Sampled one of each; both the old Home with the World Cup tab. Tablet sets are optional | **All deleted** |
| featureGraphic | "Fan Sphere — Your crew. Any city. Every game. LIVE WATCH PARTIES · FAN GROUPS · CLIPS". No tournament content | **Kept** |

**The literal string "FIFA World Cup 2026" was in the published Play listing
until today.** That is the exact mark Apple cited under Guideline 5.2.1,
sitting in a published listing on the other store.

Codex required phone3 be deleted as well as 4–6: country names and a soccer
tag do not establish tournament content, but its contradictory attendance
display and uncertain fidelity to production do disqualify it, and keeping it
purely to pad the screenshot count is not a reason.

## Listing text

Replaced with an interim version that strips the tournament **without**
advertising Home Team or MVP. That restraint is deliberate: production still
serves versionCode 5, so advertising subscriptions that binary may not offer
would trade one mismatch for another.

Removed: the "cheering on your national team during the World Cup" clause; the
entire `🌍 BUILT FOR WORLD CUP 2026` section promising group-stage tracking,
knockout brackets and country-by-country fan rooms; and the entire
`⭐ FAN SPHERE PASSES` section offering a "World Cup Pass — $19.99 one-time"
and a "Pro — full-season premium (coming soon)" that never existed.

Also neutralised soccer-leaning wording left over from the tournament
positioning — "every goal" to "every play", "MATCH CLIPS" to "GAME CLIPS",
"every match" to "every game" — which fits the multi-sport position the app
now holds.

Dropped the ESPN name from the public description as an **editorial choice**,
not a compliance requirement. Apple's 2.3.10 does not prohibit every
third-party name; it addresses other mobile platforms, marketplaces and
irrelevant metadata, and nothing in it requires or forbids ESPN attribution in
a store description. ESPN remains disclosed in the privacy policy. If a data
licence or usage agreement separately requires attribution, privacy-policy
disclosure would not automatically satisfy it — that is worth checking
against whatever terms the ESPN endpoint is used under.

Short description is now "Live sports watch parties, fan groups and clips"
(47 chars), with no trailing period per Google's formatting guidance.
Full description is 1192 characters.

## Verified after commit

Re-read live, independently of the edit:

- shortDescription and fullDescription as above, with a **targeted term scan**
  returning no hits for `world cup`, `fifa`, `soccer cup`, `19.99`, `bracket`,
  `tiktok`, `instagram`, `espn`. That is a check against a specific list, not
  a finding of general compliance
- phoneScreenshots 2, sevenInch 0, tenInch 0, featureGraphic 1, icon 1
- Tracks untouched: production 5, alpha 6, internal 2, beta empty

The edit was committed with `changesInReviewBehavior=ERROR_IF_IN_REVIEW` on
Codex's instruction, so it could not silently cancel and resubmit an existing
review. A successful commit is not proof the revised listing is publicly
visible yet — that depends on review and the publishing state.

Rollback source: `pre-change-backup.json` in this evidence folder holds the
complete prior listing, image IDs and URLs.

## iOS

- Build 40 is selected on the version, which is in PREPARE_FOR_SUBMISSION.
- Listing copy was cleaned on 2026-10-28.
- **Removed the empty iPad screenshot set** today — unnecessary for an
  iPhone-only build rather than a confirmed blocker. `supportsTablet` is
  `false`, and build 40's own identity record states **iPhone device family**,
  so the set had no purpose. One set remains: iPhone 6.7", three images.
- Those three images are the **onboarding carousel**, at 1320×2868 —
  dimensionally valid, clean, native iOS status bar, but **insufficient as the
  complete screenshot set**. Apple's 2.3.10 next steps ask that revised
  screenshots "accurately reflect the app in use" and "highlight the app's
  main features in the majority of the screenshots", and 2.3.3 covers
  app-in-use screenshots separately. Three onboarding slides are not the app
  in use.

## What cannot be finished without something I do not have

The owner asked for Game Day images to be added and for everything to be ready.
Neither store's screenshot set can be completed today:

- **iOS.** The tester's captures include a good Game Day screen, but every file
  arrived at 471×1024 because WhatsApp recompressed them. They cannot be
  uploaded and must not be upscaled. **This needs the originals**, which exist
  on the tester's phone. Their device appears to produce 1320×2868, matching
  the set already on the version, but the originals' dimensions and content
  stay unverified until they arrive — and the missing and dirty captures need
  taking regardless.
- **Android.** There is no current build to capture from. The newest artifact
  predates the tournament removal, so capturing from it would reproduce the
  World Cup screens just deleted. **This needs the Android build** — pin
  `build.production.android.image` first, then build, then Claude can capture
  the set on the emulator here.

Both stores are now *clean*. Neither is *complete*.

## State after today

| | iOS | Android |
|---|---|---|
| Listing text | Clean | Clean (interim) |
| Tournament imagery | None present | **Removed from the committed listing today** |
| Screenshots | 3 onboarding, need app-in-use set | 2 onboarding, need app-in-use set |
| Build | 40 selected, PREPARE_FOR_SUBMISSION | No current replacement build; production still on versionCode 5 |
| Screenshot prerequisite | Tester's original files | Pinned image, then a build |

**Neither platform is submission-ready**, and this table covers store assets
only. The other open gates are listed in
`release-submission-readiness-2026-10-27.md` and
`android-readiness-2026-11-05.md` — on iOS, purchase/restore/MVP validation,
footage rights, device acceptance and the submission checks; on Android, the
target API decision, the permission and contacts declarations, and the data
safety form.
