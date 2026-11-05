# Submission actions — 2026-11-04

Owner said proceed. Two items: the legacy products, and the brief to send the
iOS tester. Revised after Codex review.

## Legacy products: withdrawal is not needed for the present remediation

The standing question was whether to withdraw `premium_monthly_999`,
`premium_annual_10788` and `wc_pass_2026` from sale, since Apple named exactly
those in the Guideline 2.1(b) message. Codex's condition was to check existing
customers and entitlements first, and to keep removal from *sale* distinct
from removal from a *submission*.

Queried live. **All seven products are state `READY_TO_SUBMIT`** — the six
subscriptions (`home_team_monthly_499`, `home_team_annual_3499`,
`mvp_monthly_1499`, `mvp_annual_9999`, `premium_monthly_999`,
`premium_annual_10788`) and the one non-consumable (`wc_pass_2026`). Each
reports `availableInNewTerritories: true`, which concerns future territory
expansion and says nothing about current sale availability or past sales.

`READY_TO_SUBMIT` indicates a product has never been approved, and Codex found
no documented transition that returns an approved, previously sold product to
that state. So **the reported states indicate these products never reached
production sale** — which is weaker than a transaction-history audit, and
leaves room for sandbox transactions, manual grants, or historical
entitlements held outside these Apple products.

On that basis **the reported states show no approved production offering
requiring withdrawal for this remediation**: these are drafts that never
cleared review, not live products being pulled. The action is the distinction
Codex drew — **keep them out of the submission**.

**Not deleting them.** Nothing requires it, deletion is irreversible, and
Apple does not permit a deleted product ID to be reused in the same app.
Deletion eligibility was not separately verified, so even "it would work" is
more than the evidence supports.

**What exclusion does not do.** It does not by itself resolve 5.2.1. Apple
offers no guarantee that an unattached product is invisible to a reviewer, who
in any case has the prior rejection history. The concern is only resolved when
the submitted app and its metadata stop presenting the disputed content —
and the store-refresh record still leaves visual clearance and footage rights
open.

**Two things to do when assembling the submission:**

1. Make sure the **app-level review notes and the rejection response** name
   all three retired product IDs, state that they are no longer offered, and
   name the four replacements. Apple's 2.1(b) expressly asks for an
   explanation of configured purchases that cannot be found in the app.
   Codex's store-refresh updated the pass's individual review note; the
   app-level wording still needs checking.
2. **Inspect the actual items included in the submission** rather than
   inferring attachment from product state or from the absence of a prior
   submission.

Disabling availability remains an optional safeguard against accidental future
activation. It is not remediation.

## Brief for the iOS tester

> Thanks — these came through but WhatsApp shrank them. Every image arrived at
> 471×1024 and about 40 KB, and the App Store needs the full-size originals,
> so I can't upload any of them.
>
> **First, one test file.** Send me a single screenshot as a file and let me
> check it before you redo the whole set — no point repeating the batch if the
> transfer is still shrinking them. In WhatsApp: Attach → **Document** → pick
> the image. If that is awkward, save the shots into the Files app first and
> attach them from there. AirDrop or an iCloud link also work. By email,
> choose **Actual Size / Original**. Anything sent as a *photo* will be
> shrunk again.
>
> Then resend everything else the same way — send all of them, including the
> ones you think are rough, and I'll pick.
>
> **Screens to take or retake when you get a moment:**
>
> 1. **Home tab** — wasn't in the set
> 2. **A watch party, opened up**, showing who's going — wasn't in the set
> 3. **The group chat again, with the keyboard closed** — make sure it is
>    visibly gone before you capture, and use a made-up demo conversation
>    rather than anything real or personal
> 4. **Discover** — hold this one, see below
>
> **Also the four plan screens**, which are for Apple's reviewers rather than
> the store page: Home Team Monthly, Home Team Annual, **MVP Monthly** and
> **MVP Annual**. Each should show the period you picked, the price, the small
> print and a clean button. You only did the Home Team ones last time; MVP
> wasn't covered at all. These show what the screens look like — testing that
> a purchase actually goes through is a separate job and I'll come back to you
> about it.
>
> **Hold Discover and the watch-party shot for now.** Discover and the search
> both came back showing no watch parties, and a watch-party screen was never
> captured. I'll confirm when there's a party visible on your account and let
> you know.
>
> A few things for every capture: use the **TestFlight build 40** you already
> have, and **turn Focus or Do Not Disturb on** before you start, with its
> notification exceptions off, so nothing pops up mid-capture. Make sure
> nothing is on screen that shouldn't be — no alerts, no loading spinners, no
> keyboard. Don't crop or edit afterwards.
>
> Also — what iPhone model and iOS version are you on?

Note: I have not approved any of the existing captures yet beyond the two that
looked content-clean. Several show purchase spinners, a restore alert, and an
unexplained `{}` beside the clock — the originals decide whether that symbol
is actually a problem. The Clips capture still depends on the unresolved
footage rights question.

## Still blocked on us

Confirming an upcoming watch party is visible to the capture account. Claude
has no production data access, so this is Codex's or the owner's check. Until
it is done, two captures cannot happen.
