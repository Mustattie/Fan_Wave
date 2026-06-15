# Fan Sphere Android v6 — Closed Testing release notes

Drop this directly into the Google Play Console **Closed Testing → Create release → Release notes** field. Concise, tester-facing, no engineering vocabulary.

---

## What to put in the "Release notes for English (United States) – en-US" field

```
v6 beta — Soccer Cup rebrand + reliability fixes

Major reliability and consistency pass before public launch:

• Fan groups now create successfully — fixed the database error some
  testers were hitting when tapping "Create Group"
• Watch parties now show up in the Soccer Cup tab once you create them
• Posting clips is instant — your clip appears in the feed immediately
  with an "uploading…" placeholder instead of a one-minute wait
• Watch-party venue search expanded to a 30 km radius around your city
  and now matches the name you type instead of returning random places
• "Soccer Cup" replaces "World Cup" across the app (tab, screens, IAP)
• Chat messages and live RSVPs now push to subscribers in real time
  instead of requiring a manual refresh
• Buy Soccer Cup Pass button now opens the Google Play purchase sheet
  reliably (the old "Purchase could not start" alert is gone)
• Form screens no longer have the keyboard covering the field you're
  typing into, and the Create Group button sits above the system nav bar
• Free-tier users no longer get bounced to the Subscription screen on
  app resume after being backgrounded

Please test the flows listed in the tester one-pager you received and
report issues via our beta channel. Thank you for testing!
```

---

## Suggested length

Google Play hard caps release notes at **500 characters** for the public version label, but the internal beta release notes field has a soft 4,000-char cap. The block above is well under both.

If you need the **shorter 500-char version** for the public-facing label:

```
v6 beta — Soccer Cup rebrand + reliability fixes. Fan group creation
fixed. Watch parties now visible in the Soccer Cup tab. Clip posting
is instant. Venue search expanded to a 30 km radius. Chat + RSVPs
update in real time. Soccer Cup Pass purchase works again. Keyboard
no longer covers form fields. Free users no longer bounced to
Subscription on app resume. Please test and report issues.
```

---

## How to upload to Closed Testing

1. **Download the AAB** from EAS (the URL is in the build success message — paste it into your browser).
2. https://play.google.com/console → **Fan Sphere** → **Testing → Closed Testing**.
3. Click into an existing track (e.g., "Fan Sphere Beta") or **Create track** if there isn't one.
4. **Create new release** → drag in the v6 AAB.
5. Paste the release notes block above.
6. **Testers** tab → add your tester Gmail addresses (paste them one per line) OR link a Google Group.
7. **Review release** → **Start rollout to Closed Testing**.

Status flips to "Available to testers" within ~5 minutes. Testers get a Google Play email with an opt-in link. From there, they search "Fan Sphere" in Play Store and the v6 test version installs.

**Critical: do NOT use "Production" track for v6.** The gating plan requires Closed Testing first.
