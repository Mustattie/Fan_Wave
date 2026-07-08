# Fan Sphere v9.0 — Year-Round Multi-Sport pivot

Drop this into the Google Play Console **Closed Testing → Create release → Release notes** field and (with light edits) the App Store Connect version notes field. Tester-facing, no engineering vocabulary.

---

## What to put in the "Release notes for English (United States) – en-US" field

```
v9.0 — Fan Sphere, every sport, every season

We rebuilt the app around what you actually asked for: a home for your
teams year-round, not just during one tournament. What's new:

• New Game Day tab — every live and upcoming game, across every sport
  you follow (NFL, NBA, MLB, NHL, MLS). One place, live scores, tap
  through to watch parties and clips
• Discover reorganized — Fan Groups now live inside Discover with
  Joined/Suggested tabs, so finding your crew is one tap instead of
  two. Create a new group from the "+ Create" button here too
• 5-tab layout — Home / Discover / Game Day / Clips / Profile. We
  removed the Soccer Cup tab; the same fan-group and watch-party
  content is still there, just easier to reach
• Existing Soccer Cup Pass holders — thank you for the early support.
  Your pass has been upgraded to 3 months of Fan Sphere Premium,
  starting today. Nothing you need to do — it's already active
• Create Watch Party is faster — one paywall, one flow, works for
  every sport (was two branching flows before)
• Live game status is more accurate — end-of-period, overtime, and
  penalty shootouts now show up correctly on the Game Day cards

If you were mid-way through creating a fan group under the old Soccer
Cup tab, your progress isn't saved (it was only stored on your device
in test mode). Retry the create flow under Discover — it will save
properly this time.

Report issues via your beta channel. Thanks for helping us reshape.
```

---

## Length check

- Google Play caps public release notes at **500 characters**; the internal beta field allows **4,000**. The block above is well under both.
- App Store Connect caps "What's New" at **4,000 characters**. Same block fits.

---

## Reviewer notes (Apple + Google internal notes field)

For App Review + Play Console reviewer-notes fields:

```
v9.0 is a repositioning release, not a feature-add release. The Soccer
Cup 2026 tab has been removed; all watch-party, fan-group, and live-
score functionality is now organized under Discover (fan groups + watch
parties) and Game Day (live/upcoming games across NFL, NBA, MLB, NHL,
MLS). No new IAP products. Legacy Soccer Cup Pass holders were
grandfathered server-side to 90 days of Premium; no purchase or restore
prompt shown to those users.

Reviewer test account: fansphere.reviewer@gmail.com
Reviewer bypass in place — see mig 053 in Supabase migrations.
Sandbox purchase flow: Premium Monthly $9.99, Premium Annual $107.88.
No Soccer Cup Pass product remains in the RevenueCat offering.
```

---

## Marketing copy (App Store Connect subtitle + Play Store short description)

**App Store Connect subtitle (30 char cap):**

```
Your team. Every season.
```

**Play Store short description (80 char cap):**

```
Watch parties, live games, and fan groups for every sport, all year round.
```

**Play Store full description (4,000 char cap) — replace the existing Soccer-Cup-forward copy:**

Full copy lives in a follow-up doc; core three verbs are **Watch** (parties + venues), **React** (clips + moments), **Belong** (groups + follows). NFL season kickoff = the launch anchor.
