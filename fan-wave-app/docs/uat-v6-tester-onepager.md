# Fan Sphere v6 — Tester Quick-Start

Hey! Thank you for helping us make Fan Sphere better before Soccer Cup 2026 kicks off. This is the **beta test cohort** — we want real-world feedback on a real device before we open the app to everyone.

The whole pass takes **~30 minutes** spread over a couple of days. You don't have to do it all in one sitting.

---

## Setup (one time, ~5 minutes)

### iPhone testers
1. You'll receive an **email from TestFlight** with a link to install Fan Sphere (build 10). Tap the install link from the iPhone you'll be testing on.
2. Open TestFlight when it prompts, accept the invite.
3. Install Fan Sphere from the TestFlight app.

### Android testers
1. We added your Gmail address to the closed-testing tester list. You'll get an email from Google Play with a link like *"You're now an internal tester for Fan Sphere"*.
2. Tap **"Become a tester"** in the email, accept.
3. Open Google Play on your Android phone, search **Fan Sphere**, install (it will install the v6 test version).

### Both
4. Open Fan Sphere, **sign up with your real email** (not a throwaway).
5. Complete onboarding — pick 2–3 sports (include Soccer), pick 3–5 teams, set your home city to where you actually are.

You should land on the **Home** screen with the bottom tab bar showing: Home · Discover · Clips · **Soccer Cup** · Groups · Profile.

> ⚠️ If anywhere in the app you see **"World Cup"** or **"FIFA"** — that's a bug. Take a screenshot.

---

## The 10 tests

For each test: **What to do** → **What you should see** → **What to report if it's wrong**. Capture a screenshot or short screen-recording for anything that misbehaves.

---

### Test 1 — Cold launch (smoke check)

**Do:** Force-close Fan Sphere (swipe up + flick away), wait 10 seconds, reopen.

**Should see:** App opens to Home in under 5 seconds. No crash. No "Connection problem" alert.

**Report if:** App crashes, hangs on a black screen, or shows a connection error.

---

### Test 2 — Stay signed in across a break

**Do:** Sign in. Browse around for a minute or two. Lock your phone and **wait at least 30 minutes**. Unlock and reopen Fan Sphere from your home screen.

**Should see:** You land back on whatever screen you left, or on Home. You should **NOT** be sent to a "Subscription" or "Choose Plan" screen.

**Report if:** The app dumps you on a Subscription / Upgrade screen after the break.

---

### Test 3 — Create a fan group

**Do:** Tap the **Groups** tab → tap the **+** button (top-right). Type a group name like *"Real Madrid Fans"*, pick **Soccer** as the sport, leave it Public, tap **Create Group**.

**Should see:** A green success message. The new group appears in your Groups list. No red error pop-up.

**Report if:** You see an error mentioning *"infinite recursion"* or *"policy"* or *"could not create"*. Take a screenshot of the exact error wording.

---

### Test 4 — Create a watch party (with venue search)

**Do:** Tap the **Soccer Cup** tab → tap the green **+** button (bottom-right). On the venue search screen, **type a real sports bar or restaurant name near you** (e.g., "Buffalo Wild Wings", "Twin Peaks", or your favorite local spot). Tap Search.

**Should see:** A list of real venues near your location. You should be able to pick one. If your specific venue isn't there, try a generic word like *"bar"* — you should see actual nearby bars.

**Report if:**
- The list is empty when you know that venue exists in your city
- The results are in a completely different city (e.g., you're in Dallas but it shows Chicago places)
- You see "Chicago" as a venue when you're not in Chicago

Then continue: pick a venue (or tap "Enter venue manually"), pick a time, set capacity, tap **Create Watch Party**. Confirm the party appears in the Soccer Cup tab.

---

### Test 5 — Post a clip

**Do:** Tap the **Clips** tab → tap the **+** button. Pick a short video (under 30 seconds — anything from your camera roll). Fill in a quick title like *"My test clip"*, pick a sport, tap **Post Clip**.

**Should see:** Within 1 second you bounce back to the Clips feed and **your new clip is visible at the top** with a "Posting…" label and a small spinner. After 10–30 seconds (depending on your connection), the spinner disappears and the clip plays normally.

**Report if:**
- You're stuck on the Posting screen for over a minute
- The clip never appears in the feed
- The clip appears but you see the same clip twice (duplicated)

---

### Test 6 — Send a chat message in a group

**Do:** Tap into one of your groups (or one you joined). Send a few short messages. **If you can get a friend or one of the other testers in the same group**, watch whether their messages appear on your screen within a couple seconds (without you refreshing).

**Should see:** Your messages send instantly. Other people's messages show up on your screen within ~2 seconds, no refresh needed.

**Report if:**
- Your message doesn't appear after sending
- You have to pull-to-refresh to see new messages from others
- The chat feels "frozen" or "stuck"

---

### Test 7 — RSVP a watch party

**Do:** Open the **Discover** tab → scroll to **Watch Parties Near You**. Tap one. Tap **Going**.

**Should see:** Your status updates to Going. The attendee count goes up by 1.

**Report if:** Nothing happens when you tap Going, or the count doesn't update.

---

### Test 8 — Buy the Soccer Cup Pass (sandbox / test card)

**Do:** Go to **Profile** → **Subscription**. Tap the green **Buy Soccer Cup Pass — $19.99** button. The Google Play / Apple purchase sheet opens.

⚠️ **IMPORTANT:** This is a **real purchase** if your account has a real payment method attached. **CANCEL at the Google Play / Apple purchase sheet** unless your tester invite gave you a sandbox/promo code. The whole point of this test is verifying the button opens the purchase sheet, NOT actually buying.

**Should see:** The native Google Play (Android) or Apple App Store (iOS) purchase sheet appears showing "Soccer Cup Pass" / "$19.99" / Buy button. Cancel out of it.

**Report if:**
- An error pops up like **"Purchase could not start"**
- The button does nothing when tapped
- The native purchase sheet doesn't appear
- The sheet shows "World Cup Pass" instead of "Soccer Cup Pass"

---

### Test 9 — Keyboard behavior on Create Group screen

**Do:** Profile → tap your name to edit profile, OR Groups → + → Create Fan Group. **Tap on the Description field** (one of the lower fields on the form). Type something.

**Should see:** The keyboard appears WITHOUT covering the field you're typing in. The screen scrolls so you can see what you're typing. The "Create Group" / save button at the bottom is **not cut off** by your phone's nav bar.

**Report if:**
- You can't see the field while typing because the keyboard is on top of it
- The Create / Save button at the bottom is clipped or hidden by the system nav bar
- You have to scroll to find the button

---

### Test 10 — Delete your test account (only do this last!)

**Do:** Profile → scroll all the way to the bottom → tap **Delete Account** (red row with trash icon) → type **DELETE** in the confirmation box → tap **Permanently Delete My Account**.

**Should see:** "Account deleted" confirmation. You're signed out and returned to the Welcome screen. If you try to sign in with that same email and password, it fails.

**Report if:** The delete flow errors, hangs, or you're still signed in afterward.

---

## How to report issues

When you find something broken, send us one message per issue with:

1. **Test number** (e.g., "Test 4 — Venue search")
2. **What you did** (3-line summary)
3. **What happened** (vs what you expected)
4. **Device + OS** (e.g., "iPhone 14 Pro, iOS 18.4" or "Samsung Galaxy S22, Android 14")
5. **A screenshot or screen recording** — this is the most useful thing you can attach

Send to: **`<insert your tester reporting channel — Discord / Slack / email>`**

If something seems **severe** (crashes, can't sign in, lost data, charges your card unexpectedly), put **"P0"** at the start of the message so we see it first.

---

## What we're NOT asking you to test

Skip these for now — they're either covered by other testers or being worked separately:

- Push notifications (not enabled yet)
- Sharing clips to TikTok / Instagram (next release)
- Group video calls (not built)
- Live game scoring accuracy (separate validation)

---

## Final thoughts

Test in the same way you'd actually use the app — go look at a real game's matches, create a real watch party for an upcoming match you'd want to attend, react to clips like they're your friends' posts. The more "real" your testing, the more useful your feedback is.

Take your time, take breaks, come back tomorrow. The cohort runs **3–5 days**, not 30 minutes. We'd rather get thorough feedback than a rushed walkthrough.

Thank you. 🙏 Once we ship to the App Store + Google Play, you'll be the first to know.

— Fan Sphere team
