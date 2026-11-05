# iOS screenshot recapture — plan and tester brief, 2026-11-05

The owner chose to recapture with a location set and a populated watch party,
rather than submit the current set or hold it down to two images.

**Two prerequisites must be done before the tester touches the phone**, or the
recapture produces the same screens again. Revised after Codex review, which
corrected five things — including who can actually do the seeding.

## Prerequisite 1: a genuinely populated watch party

`03-watch-party.png` currently shows "Tennessee Volunteers vs Wofford
Terriers" at Chili's Grill & Bar, Frisco, with **"1/50 going"** and
**"No description provided"**. It is dated **Tuesday, November 3, 2026**,
already in the past, so it would not render as upcoming regardless.

What is needed is a public watch party with:

- a **real upcoming fixture** — not the old matchup moved forward
- a real venue, and a kickoff a few days out with the timezone confirmed
- a written description, so About is not "No description provided"
- **several genuine RSVPs** through the normal flow

**The attendee count must be what the app actually rendered.** See the spec
below for how that is satisfied — seeded accounts that genuinely RSVP are
fine; writing a number the app did not produce is not.

### Readiness check before the tester is told to start

Record, and confirm each one:

- party ID, venue name and address, the **exact city**
- linked game, kickoff time **and timezone**
- the description text
- the **actual** Going count
- that the capture account can see the party on Home **and** open its detail

A future date alone does not establish visibility. The source matches Home
parties on `venue_city` **or** `venue_metro`, with a nationwide fallback, so
visibility has to be observed rather than assumed.

### Who does this — currently nobody, and that is the blocker

I have no production write access. **Codex has confirmed it cannot seed
production in this session either**: its shell is read-only, network access is
restricted, and no production database connector is available. The earlier
draft of this plan called it "Codex's step", which overstated its access.

**This needs the owner, or a Codex session with production write access.**
Everything downstream waits on it.

## The party to create — spec, decided 2026-11-05

Owner chose **Dallas**. It matches the data already present better than Frisco
did: the existing groups are *Dallas Legends* (9 members) and *Dallas Wings*.
Frisco sits in the Dallas metro, and Home matches on `venue_city` **or**
`venue_metro`, so the existing Frisco venue still surfaces alongside it.

| Field | Value |
|---|---|
| City | **Dallas** |
| Game | a real upcoming fixture, picked from the live schedule at creation time |
| Venue | a real Dallas venue |
| Start | a few days out, timezone confirmed |
| Visibility | **public** (private is Home Team gated; public is free) |
| Description | written — must not read "No description provided" |
| **Capacity** | **~15** |
| RSVPs | **4–5 seeded accounts**, actually RSVPing through the normal flow, with one or two as *Maybe* so the Going / Maybe / Can't Go split is not all one column |

**On the capacity number.** The old capture read "1/50 going" over a nearly
empty progress bar, which looks sad whatever the attendee count. A capacity
around 15 means 5 going renders as a healthy, half-full bar — real data,
sensibly chosen, nothing inflated.

**On seeded accounts.** An earlier draft of this plan, following Codex's
caution, said test accounts would not constitute genuine attendees. That
conflated two different things and was stricter than it should have been:

- **Fabricating a number** — writing "45/80 going" into a row, or editing an
  image — is the inaccurate-metadata trap, and stays out.
- **Seeding demo data** — accounts that genuinely RSVP, so the app genuinely
  renders the count — is normal practice, and the screenshot is then a true
  rendering of real database state.

The rule held here is only that nothing is written that the app did not
render, and no image is edited.

## Prerequisite 2: a city on the capture account

`01-home.png` shows a location pin followed by "· Change" with **no city
name**. That reads as unfinished and is the strongest reason to retake Home.

**Decided: Dallas.** See the spec above for why it fits the existing data
better than Frisco.

## Brief for the tester

Send this once the party exists and the city is decided.

> Thanks — the Home and Game Day shots came out well and are already uploaded.
> I need five retaken, and there are two setup steps first.
>
> **Before you start:**
>
> 1. **Turn Focus off** for this session, and **turn off notification
>    banners** too — silent mode on its own doesn't stop them appearing.
>    Four of last time's shots had a `{}` symbol next to the clock where the
>    Focus icon sits; the 4:53 ones were fine, the 4:02–4:03 ones weren't.
> 2. **Set your location in the app** to **Dallas**. On Home, tap the
>    pin at the top — it currently shows no city — and pick it. Then pull Home
>    to refresh and check you can see both the city and the watch party
>    **[party name]** before you capture anything.
>
> **Then retake these five:**
>
> 1. **Home** — with the city showing and "Watch Parties Near You" populated
> 2. **The watch party [party name], opened up** — showing the description and
>    the people going. If the description and the attendee list don't both fit
>    clearly in one frame, send **two** shots of it and I'll pick
> 3. **Link a game**
> 4. **Create watch party** — scroll so the composition is clean; last time
>    the "1 hr before" option was half-hidden behind the bottom bar
> 5. **Profile**
>
> **Send them as files, not photos** — WhatsApp: Attach → Document. Or
> AirDrop / iCloud link / email at Actual Size. **Send one first** so I can
> check it before you do the rest. They should come out **1206 × 2622** from
> the same phone you used last time.
>
> Same as before otherwise: TestFlight **build 40**, no alerts, no loading
> spinners, no keyboard, nothing private on screen, and no cropping or editing
> afterwards.

**Filename mapping**, so the replacements line up with what is on the version
— note this is the order Codex uploaded, and the earlier draft of this brief
had 04 and 05 the wrong way round:

| File on the version | Screen |
|---|---|
| 01-home.png | Home |
| 02-game-day.png | Game Day — **keep, not being retaken** |
| 03-watch-party.png | Watch party detail |
| **04-link-a-game.png** | Link a game |
| **05-create-watch-party.png** | Create watch party |
| 06-profile.png | Profile |

## What happens to the current set

The six stay on the version until validated replacements exist. That is a
workflow preference, not a requirement — removing only 03–06 would leave two,
which is valid, since Apple allows one to ten per device size. Deleting all
six would leave the sole set empty, which is the thing to avoid.

`02-game-day.png` stays as it is either way.

## Sequence

1. **Seed the party** — owner, or a Codex session with production write
   access. **Blocking, and currently unassigned.**
2. Run the readiness check above and fix the exact city.
3. Tester sets the city, turns Focus and banners off, confirms Home shows both
   the city and the party.
4. Tester sends one file for a size check, then the other four.
5. Claude validates dimensions, status bars and content, then swaps the set.
