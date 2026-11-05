# iOS screenshot set — state and open decision, 2026-11-05

## Where the set now stands

The App Store version carries **one screenshot set**, `APP_IPHONE_61`
(Dynamic Island medium, 1206×2622 — Apple's required iPhone class), holding
**six images**, all `COMPLETE`:

| File | Screen | Status bar |
|---|---|---|
| 01-home.png | Home | Clean — silent-mode bell |
| 02-game-day.png | **Game Day** | Clean — silent-mode bell |
| 03-watch-party.png | Watch party detail | **`{}` beside the clock** |
| 04-link-a-game.png | Link a game | **`{}` beside the clock** |
| 05-create-watch-party.png | Create watch party | **`{}` beside the clock** |
| 06-profile.png | Profile | **`{}` beside the clock** |

Codex captured and uploaded these from owner-supplied original physical iPhone
captures of **build 40**, unedited, with sha256 recorded per file in
`play-store-screenshots/current/ios/manifest.json`. The pre-pivot assets were
moved to `play-store-screenshots/archive/2026-11-05-pre-pivot/`.

This replaces the previous set, which was three onboarding carousel slides at
1320×2868 in an `APP_IPHONE_67` set. **Game Day is now represented**, which it
never was before.

## My collision, and the correction

I did not realise Codex had already created the set and uploaded all six. I
checked that an `APP_IPHONE_61` set existed but not what was in it, and
uploaded `01-home` and `02-game-day` a second time, creating two duplicates. I
deleted both duplicates by id (204 each) and a readback confirms exactly
Codex's six images remain. Nothing of Codex's was altered.

The lesson is cheap and worth writing down: **in a shared working tree, read
the contents, not just the existence, of anything you are about to add to.**

## The open decision: four images carry `{}` in the status bar

At full resolution, 03–06 render a literal `{}` immediately right of the
clock, where the Focus indicator sits. They were captured at 4:02–4:03; 01 and
02 were captured at 4:53 and show a normal silent-mode bell instead.

I had flagged this symbol in the WhatsApp copies and said the originals would
settle it. They have: **it is real**, not a compression artifact.

Codex independently inspected the same files and agrees it is real and sits in
the OS status-bar area. It corrected two things in my reading:

- The images do **not** establish a *broken* glyph. iOS supports choosing a
  custom Focus icon, so this may be a deliberately selected symbol.
- The bell-with-slash on 01/02 indicates **silent mode**, not specifically Do
  Not Disturb.

**Codex's recommendation, which I share: hold 03–06 and recapture** with Focus
off and consistent status-bar settings. Not because Apple prohibits the
character — it does not — but because it reads as stray code to a viewer, on
an app already rejected twice over screenshots.

### What holding them costs

The set drops to two images: Home and Game Day. Apple allows one to ten per
size, so two is valid. But Codex's assessment is that the two overlap
substantially and omit the watch-party experience entirely, which is the
product's headline feature.

### Quality problems in the two "clean" images

Neither is strong, and one has a defect I missed:

- **01-home** — the location line shows a pin followed by "· Change" with **no
  city name**. Codex rates this as more concerning than the legitimate
  "Be the first to host a watch party" empty state, and I agree: it looks
  unfinished rather than empty.
- **02-game-day** — real upcoming games render, but "No games live right now"
  sits above a large blank lower half.
- **03** — "No description provided" and "1/50 going" make the featured party
  look sparse.
- **05** — the bottom "1 hr before" option is partially behind the fixed
  footer.
- **06** — default avatar and a settings list carry less than a watch-party
  image would.

## The decision for the owner

Three options, and this is a quality-versus-speed judgement rather than a
compliance one:

1. **Submit with the six as they are.** Fastest. Four screenshots carry a
   stray-looking character.
2. **Hold 03–06, submit with two.** Clean, valid, but a thin showcase that
   omits watch parties, and 01 still shows a nameless location.
3. **Recapture properly.** Set a location on the capture account, seed a
   populated watch party, turn Focus off, retake 03–06 plus a replacement 01.
   Best result, costs another tester round.

**My recommendation is 3**, with 1 as the fallback if the deadline is
immovable — the `{}` is cosmetic and legal, whereas a nameless location and an
empty watch-party section are the kind of thing a reviewer reads as an
unfinished app, which is what 2.1 covers.

Nothing has been deleted. The four remain in the set pending this decision.

## Evidence

- `qa/evidence/2026-11-05/asc-screenshots/upload-20261105.json` — my upload and
  the readback
- `play-store-screenshots/current/ios/manifest.json` — Codex's per-file
  sha256, source and build attribution
