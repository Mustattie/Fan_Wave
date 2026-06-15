# Fan Sphere iOS build 10 — TestFlight External Beta release notes

Drop this into the App Store Connect **TestFlight → Builds → 1.0.0 (10) → Test Details → "What to Test"** field. Apple's external beta review reads this when approving the build for external testers (~24h turnaround, separate from full App Store review).

---

## "What to Test" field

```
v6 beta — Soccer Cup rebrand + reliability fixes

Major reliability and consistency pass. Please verify the flows listed
in the tester one-pager. Most-important new behaviour:

• Fan group creation — was hitting an "infinite recursion" database
  error on certain group types. Should now succeed cleanly.
• Soccer Cup tab Watch Parties — should populate (was empty before due
  to a query bug). Creating a watch party from this tab should make it
  appear in the same tab list.
• Clip posting — should feel instant. Tap "Post Clip" and the clip
  appears in the feed within ~1 second with an "uploading…" placeholder,
  even if the actual upload is still in progress.
• Venue search on Create Watch Party — type a real venue name in your
  city, you should get real local results within a 30 km radius, not
  random places from another city.
• "Soccer Cup" everywhere instead of "World Cup" — tab label, screen
  titles, IAP product name. There should be no "World Cup" or "FIFA"
  text anywhere user-visible.
• Real-time chat — messages from other group members should appear on
  your device within ~2 seconds without pulling to refresh.
• Buy Soccer Cup Pass — should open the App Store purchase sheet at
  $19.99. Cancel out — don't actually complete the purchase unless your
  invite included a sandbox/promo code.
• Account deletion — Profile → bottom of menu → Delete Account. Type
  DELETE → tap Permanently Delete My Account. Account should be removed
  and you should land on Welcome. Don't run this until your last test.
• App resume — sign in, browse, lock the phone for 30+ minutes, reopen.
  You should land back where you left, not on the Subscription screen.
• Form keyboard handling — when typing in a long form (Create Group,
  Create Watch Party), the keyboard should not cover the field you're
  typing into.

Sign-in demo (if you'd rather not create a fresh account):
  Email: fansphere.reviewer@gmail.com
  Password: 6CQPRem5VFYTB$c
(This is a free-tier account so you'll see paywalls in the normal places.)

Report issues with platform, device, OS, screenshot, and steps to
reproduce via the beta tester channel.
```

---

## Apple's character limit

The "What to Test" field is capped at **4,000 characters**. The block above is ~2,100 chars. Plenty of headroom.

---

## How to send to External Beta

1. App Store Connect → **Fan Sphere** → **TestFlight** tab.
2. Left sidebar → **External Testing** → click into "Fan Sphere World Cup Beta" group (or rename it to "Fan Sphere Soccer Cup Beta" — Apple allows the rename and you can do it inline).
3. **Builds** sub-tab → click **+ Add Build**.
4. Pick **1.0.0 (10)**.
5. Fill in **Test Information**:
   - **What to Test** → paste the block above.
   - Other required fields stay as before (privacy policy URL, contact email, etc.).
6. Click **Save** then **Submit for Review**.
7. Apple's TestFlight team reviews in ~24 hours. Once approved, all external testers in the group get a TestFlight email automatically.

You do NOT need to renumber or rename the existing TestFlight group.

---

## Critical: do NOT click "Add for Review" on the App Store version yet

The Apple resubmission to the App Store is gated by UAT — same as Android. The flow:

1. **TestFlight External Beta review** → ~24h. Once approved, testers can install build 10.
2. **UAT runs 3–5 days.**
3. **THEN** attach build 10 in **Distribution → iOS App 1.0 → Build section**, swap from the previous build, paste the App Review Notes, click **Add for Review**.

TestFlight Beta Review and App Store Review are two separate Apple workflows. The first proves the build is testable; the second is the actual app approval.
