# App Store listing metadata corrected — 2026-10-28

Executed by Claude against the live App Store Connect API, at the owner's
instruction to take care of item 6 of the recommendation and to work with
Codex on it. Codex reviewed the copy across two rounds before it was written.

**Independent live verification is still outstanding.** Codex's session cannot
reach the ASC API — authenticated requests fail with `connect EACCES`. It
checked the saved evidence instead and confirmed it is internally consistent:
lengths 2114 / 99 / 130, keywords 99 ASCII bytes, twelve correct bullet
characters and two correct em dashes with no mojibake, the prohibited-term
scan clear, and only the three intended attributes differing between the
before and after snapshots. That is local evidence, not a live read. The
PATCH result and readback below are Claude's.

This is a metadata change only. No binary, no product availability change, no
submission, no release.

## Why this was not already known

Neither Codex's store-refresh audit on 2026-10-27 nor any of Claude's earlier
reviews had read the version's description, keywords or promotional text;
Codex's audit covered the app name, subtitle, review information, subscription
review notes and screenshots. Both of us had also been treating Apple's 2.3.10
finding as a screenshot problem, because its **Next Steps** talk about
screenshots. Its **Issue Description** says something broader:

> The app or metadata includes information about third-party platforms that
> may not be relevant for App Store users.

The listing contained exactly that, and more besides.

## What the live listing actually said

App `6774325670`, version 1.0 (`ae38e160-a6d0-44c1-a749-746878ba17ef`), state
REJECTED, linked to build 9. Review submission `9cb026fb` is
`UNRESOLVED_ISSUES`. The en-US localization
(`286e96ef-93eb-4f35-ba6f-bc10b7fc1759`) contained:

| Violation | Text |
|---|---|
| **5.2.1** | A `SOCCER CUP 2026` section — "Dedicated Soccer Cup tab covering every match", "Available with Premium or the one-time WC Pass" |
| **5.2.1** | `soccer cup` in the keywords |
| **2.3.10** third-party platforms | "Share directly to TikTok and Instagram with one tap" in the description, and "share clips to TikTok & Instagram" in the promotional text |
| **2.3.10** accurate metadata | A Soccer Cup tab that no longer exists, and retired products at wrong prices — "$9.99/month or $107.99/year", "Soccer Cup Pass available as one-time $19.99 purchase" |

The app now sells Home Team at $4.99/$34.99 and MVP at $14.99/$99.99. The
listing was advertising a product line that has been **retired from the app's
offering** — the products still exist in App Store Connect and have not been
withdrawn from sale — and a tab that has been removed from the app.

## Verified live before writing

- **US customer prices** read from the API: `4.99`, `34.99`, `14.99`, `99.99`.
  Confirmed rather than copied from source.
- **Introductory offers**: a `ONE_WEEK` `FREE_TRIAL` exists on **both** Home
  Team products and on **neither** MVP product. The copy states the trial for
  Home Team only.
- **No custom EULA is configured** (`endUserLicenseAgreement` returns `null`),
  so Apple's standard EULA applies and is now linked explicitly.
- `https://fansphere.org/privacy/` and `/terms/` both return 200.

## What was written

Description, keywords and promotional text replaced. Name, subtitle and
support URL untouched. Section structure mirrors Codex's Play replacement copy
in `play-listing-replacement-2026-10-27.json` so both stores describe the same
product.

- Description 2114 chars (limit 4000)
- Keywords 99 (limit 100)
- Promotional text 130 (limit 170)

PATCH returned 200; all three fields matched on readback; a scan for
`soccer cup`, `world cup`, `fifa`, `tiktok`, `instagram`, `wc pass`, `19.99`,
`9.99/month` and `107.99` found none of them.

## Changes Codex required before this went live

Round 1 rejected the first draft for unsupportable claims and risk:

- "across every league" and "every season, every sport" are not established by
  the source; personalized game alerts likewise. Replaced with the Home,
  Discover and Game Day sections from the Play copy.
- "Watch every game with friends" could imply the app supplies broadcasts.
  Replaced.
- League trademarks `nba,nfl,mlb` in keywords read as trademark packing, which
  is a poor look immediately after a 5.2.1 IP rejection. Sports are now named
  generically — football, basketball, baseball, soccer, college sports — which
  Codex accepted as a reasonable middle that keeps the multi-sport positioning
  without implying league sponsorship.
- The subscription disclosure was rewritten to Apple's expected payment and
  renewal wording, with prices labelled as US.

Round 2 caught two more:

- Keywords **exceeded the limit** at 104 against Apple's documented 100 bytes.
  Dropping `live,` brought it to 99 bytes.
- "Payment is charged at confirmation of purchase" is too categorical next to
  a free trial. Now "…at confirmation of purchase, or after any applicable
  free trial ends."

## Evidence

- `qa/evidence/2026-10-28/asc-metadata/pre-change-backup.json` — full prior
  values, captured before the write. This is the rollback source.
- `qa/evidence/2026-10-28/asc-metadata/post-change-readback.json` — applied
  values, read back from Apple.

## Not done, and why

- **Legacy products not withdrawn from sale.** `premium_monthly_999`,
  `premium_annual_10788` and `wc_pass_2026` are the products Apple named in
  the 2.1(b) message. Codex's advice is that retirement needs owner approval,
  that existing customers and entitlements must be checked first, and that
  removing a product from a *submission* is a different action from removing
  it from *sale* — doing one and assuming the other is how this gets missed
  again. Owner decision.
- **The four current products are not submitted.** Preparing their metadata
  and selecting them for a draft submission is a different act from sending
  that submission to review, and the first is safe now. What must wait is the
  **submission itself**: it has to carry the corrected version and its
  replacement build, since Apple requires an accompanying version for the
  first submission of a subscription, and sending it while the version is
  linked to build 9 would put a product set in front of review that the binary
  does not offer.
- **Screenshots untouched.** Three remain live and the set is incomplete.
  That needs the new build and the capture pass in
  `capture-requirements-2026-10-27.md`.
- **Nothing submitted.** The version remains REJECTED and editable, which is
  the correct state until the replacement build exists.
