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

### DONE — party created 2026-11-05

The owner granted production access, and the party now exists.

| Field | Value |
|---|---|
| Party ID | `556bf7fe-9ddb-4803-ad99-b16e0ff45aa0` |
| Title | **Mavs vs Jazz Watch Party** |
| Game | Utah Jazz @ Dallas Mavericks (`d43fcba1-691a-461c-b9c8-f5fa322be200`) |
| Venue | **Harwood Tavern**, 333 S Harwood St, Dallas, TX 75201 |
| Coordinates | 32.77972, -96.79375 |
| City / metro | Dallas / Dallas |
| Starts | 2026-11-07T01:00:00+00:00 — **Friday 6 Nov, 7:00 PM CST** |
| Capacity | 15 |
| Visibility | public |
| Sport | NBA (`a0000000-…-002`) |
| Host | Fan Sphere Reviewer (the ASC demo account) |
| Description | written — About will not read "No description provided" |

The venue is real, returned by the app's own `venue-search` function from
Google Places, not invented. The game is a real scheduled fixture.

**Three corrections after Codex review.** Two changed production data and are
recorded in `corrections.json`; the third was a documentation error only:

1. **Description** (production) — the first version promised "we'll take the
   back room and keep the sound on for tip-off", which was never arranged with
   Harwood Tavern. Rewritten to promise nothing the venue has not agreed to.
2. **`sport_id`** (production) — was `null`. The app sets it by looking the
   sport up in the `sports` table; my seed payload omitted it. Note
   `watch_parties.sport_id` is a **uuid** while `games.sport_id` is a
   **slug**, so passing `"nba"` straight through fails with `22P02`.
3. **Weekday** (this document only) — I first wrote the start as Thursday.
   `2026-11-07T01:00Z` is **Friday 6 November, 7:00 PM CST**.

**Database checks, not observed app behaviour.** Querying production as the
demo account: it is the only upcoming public party, it matches `venue_city`
and `venue_metro` = Dallas, and it is title-searchable. That establishes the
rows are right; it does **not** establish what the capture account sees on
device. Evidence: `created.json` holds the payload and single-party readback,
`corrections.json` holds the two production fixes. Neither file substantiates
the discoverability queries — those were run in-session and are reported here,
not saved.

### The selected build moved to 41

Codex cut build **41** and selected it on the version while this was in
progress. The six captures currently on the version came from **40**.

Per Codex's source comparison, build 40's source is `1249723` and 41's is
`dd2bebd`, and the only user-visible iOS difference between them is on the
**Subscription** screen — platform-specific cancellation wording, which now
names App Store account settings instead of mentioning both stores. None of
the six captured screens is affected. That is source evidence, not a
device-to-device comparison.

**Recapture from 41 anyway**, so the evidence matches the candidate actually
being submitted. `02-game-day.png` is retained, subject to confirming it still
represents 41.

Note also that the reviewer-plan access fix was already in 40 via `ec15fdb` —
it is not new in 41, and the review notes should not imply otherwise.

### The one gap: attendees

**`rsvp_count` is 1** — the host's automatic RSVP.

I could not seed more **with the access I have**. Signup on this project
requires email confirmation: `/auth/v1/signup` returns `confirmation_sent_at`
and no session, so an account stays unable to sign in — and therefore unable
to RSVP — **until someone confirms its mailbox**. With the demo-account
credentials I hold, writing RSVP rows for accounts I am not signed in as would
also be refused by RLS. Neither limit is absolute: a confirmable mailbox, or
privileged access, would lift them.

What does not change with more access is the line itself — no impersonating
real users, and no presenting a fictional gathering as a real public
commitment.

To be precise about what did and did not block this, since the first draft
overstated it:

- Email confirmation blocks an **unconfirmed** account until it is confirmed.
  It is not a permanent bar on new accounts — if someone can confirm the
  mailbox, those accounts work.
- "Blocked by RLS" depends on the credentials. Privileged access could bypass
  it. I do not have that, and would not use it for this.
- Authorised fictional demo accounts are **not** inherently dishonest — Apple
  actually prefers fictional account information in screenshots. The line is
  impersonating real users, or presenting a fictional gathering as a real
  public commitment.

So the attendee count has to come from real people tapping **Going** — the
owner, the tester (San), anyone else willing. Three or four is plenty.

**Do this before the tester captures the party screen**, or the detail shot
shows 1 going and the point of the exercise is lost.

### This is a live public event, which is a decision not a detail

The party is discoverable in production. A stranger in Dallas can find it and
RSVP. The description has been rewritten to promise nothing the venue has not
agreed to — an earlier version said "we'll take the back room and keep the
sound on for tip-off", which was never arranged with Harwood Tavern and is now
removed.

**Resolve this now, not after the screenshots.** While it sits there
discoverable, a stranger can RSVP and turn up on Friday evening expecting
other people. Either someone genuinely intends to host it — in which case
leave it up — or it should come down immediately and the capture can use a
party created and removed inside a short window. Leaving it public "until the
screenshots are done" is the one option that is not acceptable.

Owner's call, needed today.

## Why it was built this way — the spec behind the party above

Owner chose **Dallas**. It matches the data already present better than Frisco
did: the existing groups are *Dallas Legends* (9 members) and *Dallas Wings*.
Frisco sits in the Dallas metro, so a Frisco venue would also match a Dallas
search — though the old Frisco party itself will not reappear, since it is
dated in the past and the time filter excludes it regardless of metro.

| Field | Value |
|---|---|
| City | **Dallas** |
| Game | a real upcoming fixture, picked from the live schedule at creation time |
| Venue | a real Dallas venue |
| Start | a few days out, timezone confirmed |
| Visibility | **public** (private is Home Team gated; public is free) |
| Description | written — must not read "No description provided" |
| **Capacity** | **~15** |
| RSVPs | superseded — see "The one gap" above. Seeding accounts was not possible with the access I hold, so this needs real people tapping Going |

**On the capacity number.** The old capture read "1/50 going" over a nearly
empty progress bar, which looks sad whatever the attendee count. At capacity
15, five Going renders as a third of the bar rather than a tenth — real data,
sensibly chosen, nothing inflated.

**On seeded accounts.** An earlier draft of this plan, following Codex's
caution, said test accounts would not constitute genuine attendees. That
conflated two different things and was stricter than it should have been:

- **Fabricating a number** — writing "45/80 going" into a row, or editing an
  image — is the inaccurate-metadata trap, and stays out.
- **Seeding demo data** — accounts that genuinely RSVP, so the app genuinely
  renders the count — is normal practice, and the screenshot is then a true
  rendering of real database state.

Two rules are held here, not one. Nothing is written that the app did not
render, and no image is edited — **and** no real user is impersonated and no
fictional gathering is presented as a real public commitment. The first rule
alone is not enough: the app will happily render a description containing
promises nobody can keep, which is exactly what happened with the first
version of this party's text.

## Prerequisite 2: a city on the capture account

`01-home.png` shows a location pin followed by "· Change" with **no city
name**. That reads as unfinished and is the strongest reason to retake Home.

**Decided: Dallas.** See the spec above for why it fits the existing data
better than Frisco.

## Brief for the tester

The party exists and the city is decided, so this is ready to send — **except
for one gate**: do not send it until enough people have tapped Going that the
party screen is worth photographing. One attendee defeats the purpose.

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
>    **Mavs vs Jazz Watch Party** before you capture anything.
>
> **Then retake these five:**
>
> 1. **Home** — with the city showing and "Watch Parties Near You" populated
> 2. **The "Mavs vs Jazz Watch Party", opened up** — showing the description
>    and the people going. If the description and the attendee list don't both
>    fit clearly in one frame, send **two** shots of it and I'll pick
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
> Same as before otherwise: TestFlight **build 41**, no alerts, no loading
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

1. ~~Seed the party~~ — **done 2026-11-05**, details above.
2. **Get people to RSVP Going** — owner, tester, anyone else. **Blocking the
   party-detail capture**, and the only step with nobody assigned.
3. **Verify on the device, not the database.** Open Home and the party detail
   on the **capture account, on build 41, with Dallas selected**, and confirm
   the city, title, venue, description, host, sport label and linked game all
   render. Check the phone's timezone too — picking Dallas in the app does not
   set it, and a wrong timezone shows the wrong kickoff. Confirm the roster
   and `rsvp_count` agree after a refresh.
4. Tester sets the city, turns Focus and banners off, confirms Home shows both
   the city and the party.
5. Tester sends one file for a size check, then the other four.
6. Claude validates dimensions, status bars and content, then swaps the set.
7. **Capture before tip-off** — Friday 6 Nov, 7:00 PM CST. If it slips past
   that, pick another real upcoming fixture rather than moving this game's
   date.
