# Android screenshots captured — 2026-11-06

Six Play screenshots captured on the emulator from the production build, with
no tester involved. Files in `play-store-screenshots/current/android/`, with
per-file sha256 in `manifest.json`.

## Provenance

| | |
|---|---|
| Build | versionCode **39**, versionName 1.0.0 |
| Source | `78dbc9ce0ab3001381190ff88a6ee3cc27fd1589` |
| EAS build | `de24781b-920b-4133-8a85-c35dc6b8d8e9` |
| APK | `C:/fwc/store-remediation-20261105/android39/universal.apk` (debug-signed from the production AAB, emulator only) |
| Device | emulator `Medium_Phone`, display overridden to **1080×1920** |
| Account | ASC demo account, `home_city` already **Dallas** |
| Edited | **no** — straight `screencap` pulls |

Verified before capture that `78dbc9ce` contains `ec15fdb`, so this build
carries the tournament removal. Codex's build record shows the AAB signer
matches Play's upload certificate exactly.

## Dimensions, and one format fix

Every file is **1080×1920**, ratio 1.78:1.

That size was not an accident. The emulator's physical panel is 1080×2400,
which is a **2.22:1** ratio — and Play requires the longest side to be at most
**twice** the shortest, so a native-resolution capture would violate the
published requirement. At 1080×1920 each one is inside the limits and at the
9:16, ≥1080×1920 threshold for screenshot-based promotional placements, where
six also clears the minimum count of four.

**Format correction, caught by Codex.** `screencap` produces **8-bit RGBA**
PNGs, and Play specifies **24-bit PNG without alpha** (or JPEG). Dimensions
passing is not the same as the file passing. The captures were therefore
converted:

- `originals/` — the untouched RGBA `screencap` pulls, kept as evidence
- `upload/` — 24-bit RGB, alpha dropped, with its own `manifest.json` and
  regenerated sha256 values. **These are the files to upload.**

The status bar was cleaned with Android's built-in **demo mode** — the
`sysui_demo_allowed` setting enables the feature and demo broadcasts set the
clock and icon state. That is a platform feature applied *before* capture, not
image editing.

## What each shot shows

| File | Content | Assessment |
|---|---|---|
| `01-home.png` | "📍 Dallas", real NBA games with logos, **Watch Parties Near You** showing Mavs vs Jazz · Harwood Tavern · Tonight 7:00 PM · **4/15 going** · "2 from your groups going" | **Strong.** This is the shot the watch party was created for |
| `02-discover.png` | Dallas set, sport filters, **Joined (14)** and **Suggested (26)** | Good — note iOS showed "Joined (0)" |
| `03-game-day.png` | Upcoming games with real logos | **Weak** — see below |
| `04-clips.png` | Licensed Mixkit clip, title, poster frame | Usable — see below |
| `05-watch-party.png` | Venue + full address, NBA tag, **Friday, November 6, 2026 · 7:00 PM CST**, green bar at 4/15, Going/Maybe/Can't Go, the real description, Hosted By with Host badge | **Strong.** Everything the recapture was meant to fix |
| `06-fan-group.png` | "Mavs Frisco fans · 4 members · 1 online", no keyboard | **Weak** — one "Hi" message and a large empty area |

## Three things to decide before upload

1. **`03-game-day.png` has a "No games live right now" block** and a large
   empty lower half. Accurate, but a thin marketing image. Recapturing while a
   game is actually live would be materially better.
2. **`04-clips.png` shows a red "Delete" action**, because the signed-in
   account owns those clips. A normal viewer would not see it. Not a rule
   breach — it is what the app shows that account — but it is odd in a store
   image. A non-owning account would produce a cleaner shot.
3. **`06-fan-group.png` is mostly empty.** I deliberately did **not** post
   filler messages: that group has four real members and seeding a chat they
   can see is not mine to do. Either accept it, drop to five screenshots
   (Play's minimum is two), or have someone hold a short real conversation
   there first.

## A visible rendering issue, cause unknown

On Game Day, two of the sport filter chips render as a **bare basketball emoji
with no label**, where the first reads "🏈 NFL" and the last reads "SOCC…".
On iOS the same row reads "NBA", "NHL", "College FB" with labels.

Codex has now **confirmed this visually** and checked the source: Game Day
builds complete labels from sport icons and names, and
`components/SportPill.tsx:30` renders the full `pill.label`. Those files match
the captured commit, and there is no Android-specific label suppression. The
two chips are **NBA** and **WNBA**, whose labels should be present.

So the source does not explain it. Clipping or a runtime rendering problem
remains the hypothesis, and it needs runtime investigation rather than another
source read. Recorded as a **visible rendering issue**, not a diagnosed
defect — and it is visible in `03-game-day.png`, which is a further reason to
recapture that screen.

## Permissions

A **summary** of the merged manifest — the `android.permission.*` entries. The
full manifest also carries billing, messaging, install-referrer and vendor
badge permissions:

`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_NETWORK_STATE`,
`CAMERA`, `INTERNET`, `POST_NOTIFICATIONS`, `READ_APP_BADGE`,
`READ_CONTACTS`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO`, `VIBRATE`,
`WAKE_LOCK`, `WRITE_EXTERNAL_STORAGE`.

**No `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO`** — Codex's switch to the
Android system media picker avoids requesting broad library access. That
settles **this build's** broad photo-and-video permission requirement. It does
not clear anything in the Play Console, since nothing has been uploaded yet.

`WRITE_EXTERNAL_STORAGE` survives. It grants no additional access on Android
11+ for this `targetSdk` of **36**; that is not the same as being inert on
every Android version the app still supports.

## Still outstanding on Android

- Nothing uploaded to Play. The listing still has the two onboarding
  screenshots from the cleanup; these six replace them.
- Feature graphic untouched — it was already clean.
- Data safety form and the contacts declaration.
- versionCode 39 exceeds the live production 5 and alpha 6, so it is valid to
  upload when the time comes.
