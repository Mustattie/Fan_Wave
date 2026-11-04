# Tester screenshot validation — build 40, 2026-11-03

21 images arrived from the iOS tester in `Screenshots/` (gitignored). Validated
before upload rather than after a rejection.

**Verdict: none of the 21 can be uploaded, and a resend alone will not finish
the set. Two required screens were never captured, two more need retaking, and
one content prerequisite has to be checked first.**

Image dimensions and formats below were measured with Pillow. Descriptions of
what each image *shows* are Claude's visual observation; Codex reviewed this
document but did not see the images and could not verify those descriptions.

## Why none can be uploaded

Every file is **471×1024 JPEG, 30–51 KB**. WhatsApp recompressed and
downscaled all of them on send.

Apple accepts only specific iPhone pixel sizes, and 471×1024 is well below the
smallest of them. Enlarging these files cannot recover detail that the
recompression destroyed — the result would be visibly soft, and the App Store
set should be authentic original captures. (Resizing is not inherently
prohibited, and Guideline 2.3.10 is about other-platform and irrelevant
metadata rather than a blanket ban on scaling; the objection here is quality
and authenticity, not a rule against resampling.)

Whether the originals on the tester's phone are usable is not yet known.
Check their dimensions and content when they arrive.

## What this run supports

- **Build identification.** A TestFlight capture shows `Fan Sphere - Sports
  Social`, Thabtech LLC, **Version 1.0.0 Build 40**. That identifies the build
  the tester had installed; it does not by itself tie every other screenshot
  to that same session.
- **Price visibility on device.** The Home Team sheet rendered Monthly
  **$4.99** and Annual **$34.99** with "Save 42%", the four benefit lines and
  the trial disclosure. This is the useful result: it is direct evidence
  against the plan-visibility failure behind Guideline 2.1(b).
- **The paywall reached its success state.** One capture shows the CTA as
  "✓ Welcome to Home Team".

**That last point does not establish a completed purchase.**
`components/paywall/PremiumPaywall.tsx` sets `state = 'success'` in
`handleRestore` as well as after a purchase, and both render the same
`ctaSuccess` string. Another capture shows a "Restore Complete" alert, which
makes restore at least as likely as a new transaction. Confirming a sandbox
purchase needs a transaction record and the resulting entitlement, not a
screenshot. MVP was not exercised at all.

Similarly, the Clips capture shows a pause control over "The Perfect Spiral:
Passing Practice" — that is a playback UI state, not proof that frames
advanced, and it says nothing about rights to the footage.

## Content problems, independent of resolution

1. **Two required screens were never captured** — Home, and a watch-party
   detail screen. Resending cannot produce them.
2. **The group-chat capture has the keyboard open**, which the capture brief
   excludes, and the only message is "Testing how are you". Recapture with the
   keyboard dismissed and with consented or clearly fictional demo
   conversation content — the brief excludes legible private messages.
3. **Watch parties showed empty** in Discover ("No watch parties yet — host
   the first one!") and in a "Dallas" search ("Watch Parties (0)"). See the
   prerequisite below.
4. **Game Day's "Live now" section was empty** ("No games live right now"),
   while upcoming games rendered correctly — Tennessee vs Wofford, Boston
   College. Acceptable as-is; a capture taken during a live game would be
   better.
5. **Several captures are mid-flow states** — the restore alert, a purchase
   spinner. Useful as review evidence, not usable as marketing images.
6. **A literal `{}` appears beside the clock** on several captures (3:43,
   4:01, 4:03, 4:04, 4:05). It may be a Focus indicator mangled by the
   downscale. Inspect it at original resolution before ruling those captures
   out.

The Home Team plan sheet with a clean "Start 7-Day Free Trial" CTA and no
overlay is content-clean. Note it belongs to the **four private
purchase-review assets**, not to the six marketing screens — the brief keeps
those separate, and all four product captures still need accounting for.

## What to ask the tester for

**Resend everything as files, not photos.** In WhatsApp: Attach → Document →
pick the images. AirDrop, an iCloud link, Google Drive or an email attachment
also preserve the originals. Sending as photos will downscale them again.

**Then capture or recapture four screens:**

- Home — never captured
- A watch-party detail screen with attendees — never captured
- Group chat — keyboard dismissed, suitable conversation content
- Discover — once watch-party content is confirmed visible

The Clips capture and the clean plan-sheet capture need only their originals.

## Prerequisite to check first

The empty watch-party views establish that **no parties were visible to that
account in those views** — not that production has none. Timing, location,
filters, access or a retrieval defect could each produce it. Verify that an
upcoming watch party is actually visible to the capture account before the
tester tries again. If there genuinely is no suitable content, arranging it is
owner or authorized-operator work, and the tester captures afterwards.

This blocks only the party-dependent captures. Home, the group chat and the
rest can proceed regardless.

## Related state

Build 40 is now selected on the App Store version (commit `8c1b940`): PATCH
returned 204, readback confirms Apple build
`9870c5b8-ccb3-402e-abe9-25629ff15896`, and the version moved from REJECTED to
PREPARE_FOR_SUBMISSION. That establishes which binary is selected and that the
version is in preparation — not that anything has been submitted, approved, or
that purchase validation is complete.
