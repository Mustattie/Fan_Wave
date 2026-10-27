# Store refresh — 27 October 2026

Status: preparation in progress. No resubmission or public release authorised by this document.

Update: the owner subsequently authorised a replacement iOS build. **1.0.0 (40)** is now
VALID / IN_BETA_TESTING and verified available in the existing Outside Testers group.
Use build 40 for the friend's collection; see `ios-testflight-2026-10-27.md`.

Apple's supplied June 13 rejection concerns version 1.0, build **9**, submission
`9cb026fb-1ad4-48ce-9d42-e29a9b0bfe16`. It cites non-iOS status bars (2.3.10),
content resembling FIFA (5.2.1), and inaccessible legacy purchases (2.1(b)).
The June 11 message is collapsed in the supplied screenshots and may contain further detail.

## Verified findings

- Current navigation: Home, Discover, Game Day, Clips, Profile; no tournament tab.
- An old `wc-pass-offer` route still offered the retired $19.99 pass. It now redirects to Game Day.
- Historical party/group links could still open the retired purchase sheet, whose purchase function throws. That sheet now explains that the event ended and offers Close, without a purchase button.
- Account deletion, the profile badge, and national-team suggestion labels retained obsolete tournament wording. These have been updated without deleting historical entitlements or purchases.
- The reviewer bypass supplied MVP access but hid both plan cards. The replacement build explicitly allows reviewer accounts to inspect both sheets; ordinary paid MVP users still see no duplicate offers.
- Production text scan found zero matching groups, parties or clip rows for `world.?cup`, `FIFA` or `Soccer Cup`. This is a text scan, **not** visual clearance or proof of rights to footage/logos. Previously identified YouTube-derived clips still need a separate rights decision.
- Apple: en-US has 8 old iPad and 8 old iPhone screenshots. An iPhone screenshot explicitly shows Soccer Cup; the iPad set includes World Cup and retired purchase screens. The current app is configured `supportsTablet: false`.
- Cleanup completed: 13 stale images removed from the rejected version after matching local backup MD5s to Apple's source checksums. This includes all 8 iPad images and 5 iPhone images showing the retired tournament screen/navigation. Only 3 native introductory iPhone images remain; **this is an incomplete submission set** until current in-use screens are uploaded. No screenshots have been fabricated or substituted from build 19.
- Live Apple App Review Information and all 6 subscription review notes were updated; the retired non-consumable pass review note now identifies it as historical. Current-product notes explicitly state that the reviewer-plan fix requires a replacement build. Credentials, prices, availability and customer entitlements were not changed.
- Google Play: live en-US short/full descriptions still advertise World Cup 2026, a $19.99 pass, brackets and a dedicated tab. Existing phone/7-inch/10-inch imagery must be replaced with platform-appropriate captures.
- Existing local iPhone build-19 captures are unsuitable: old benefits, exposed IAP Diagnostics, empty Game Day and a loading clip. Do not upload these or fabricate replacements by changing status bars.
- Historical production event and league rows remain (Soccer Cup 2026 / Soccer Cup). They were not deleted. Legacy components/data and entitlement support remain for historical records; the old tournament screens are not current tabs. Text scans cannot establish which images or marks Apple objected to.

## Required native capture set

Capture from the final signed replacement build on each platform, using real native status bars,
full original resolution and no notification/keyboard/debug overlays. Keep originals unedited.
Use real populated app data; do not invent matches, users or purchase prices.

| Order | File | Screen / suggested caption |
|---|---|---|
| 1 | `01-home.png` | Home — Your crew. Every game. |
| 2 | `02-discover.png` | Discover — Find your fan community. |
| 3 | `03-game-day.png` | Game Day — Follow the action. |
| 4 | `04-clips.png` | Clips — Share the energy. Use a licensed Mixkit demo playing successfully. |
| 5 | `05-watch-party.png` | Watch party — Bring the crew together. |
| 6 | `06-group-chat.png` | Fan group — Keep the conversation going. Hide private messages. |

Separate **private purchase-review** captures, not required marketing screenshots:
Home Team Monthly, Home Team Annual, MVP Monthly, MVP Annual. Each must show the current
plan name, store-loaded price/period, disclosures and CTA. Do not publish a sandbox payment sheet
or personal account information as a public marketing image.

Apple iPhone specification: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
Use a supported original iPhone size (for example 1320×2868); verify the current size table before upload.
Do not enlarge old captures to pretend they came from a newer device. Remove the old iPad screenshot
set for the iPhone-only replacement; inspect all localisations/device sizes before resubmission.
Android: capture the final Android build; remove stale tablet imagery or replace it with genuine
tablet captures if tablet presentation is retained. Update the feature graphic if it mentions the tournament.

## Purchase review notes for the replacement build

The full reviewer-access path below is included in **build 40**, and is **not in build 39**.
Do not claim this path was hardware-tested or that a replacement build was selected until verified.

Sign in using the credentials stored in App Review Information. The review account receives
full feature access to inspect the app; this access is not a receipt or evidence of a completed purchase.
Main tabs are Home, Discover, Game Day, Clips and Profile. There is no tournament tab or event pass for sale.

1. Open Profile → Subscription.
2. Under Plans tap **See Home Team ›** for the Home Team purchase sheet, or **See MVP ›** for MVP.
3. Choose **Monthly** or **Annual**. The amount and renewal period come from the store.
4. Home Team uses **Start 7-Day Free Trial** where eligible; MVP uses **Subscribe**.
5. The purchase CTA opens the native store purchase flow when the selected product is available.
6. Restore Purchases is available from Subscription. Manage Subscription opens the platform's subscription settings.

Current products for submission:

| Product ID | Tier | Period | Expected US list price |
|---|---|---|---|
| `home_team_monthly_499` | Home Team | Month | $4.99 |
| `home_team_annual_3499` | Home Team | Year | $34.99 |
| `mvp_monthly_1499` | MVP | Month | $14.99 |
| `mvp_annual_9999` | MVP | Year | $99.99 |

Local prices and eligibility are determined by the store. Legacy `premium_*` and `wc_pass_2026`
are not the current purchase offering. Keep legacy purchase/restore compatibility; do not delete
historical customers or run the old 2099 reviewer-grant script.

## Before submitting

- Build and accept the replacement artifacts carrying these source changes.
- Replace the remaining old marketing captures with the new native set and verify image delivery/order.
- Attach correct private review screenshots and the four current products to the submission; READY_TO_SUBMIT alone does not establish version attachment.
- Verify Paid Apps Agreement, availability, RevenueCat offering/product mapping, eligible trial configuration and an actual sandbox purchase/restore on the submitted binary.
- Resolve rights to remaining third-party footage and confirm the actual FIFA objection is addressed; generic renaming is not evidence of permission.
- Update Play's prepared listing with the replacement Android binary; API commit can publish/send review, so no edit was committed during this preparation.
- Read the collapsed June 11 Apple message before sending a complete response.
- Keep existing release holds/manual release decisions in effect; do not treat metadata work as launch approval.

## Verification and handoff

TypeScript passed after the completed dependency installation. Full suites on the current source:
iOS 46 suites / 393 tests passed; Android 46 suites / 391 tests passed.
Focused subscription/revenue tests passed 14 tests, including reviewer access to both plans,
ordinary paid-user duplicate-offer suppression, free-user access, and dismissal of the retired-event notice.
These are automated checks, not a native purchase or device acceptance result.
Earlier attempts made before dependency extraction finished were invalid; the final results above
come from the complete installation. TypeScript also caught a removed variable still referenced
by the profile badge; that reference was corrected before the final passing check.

Apple readback confirms the updated review information, 13 removed images, and 3 remaining introductory
screenshots. There are no app preview videos. Name/subtitle were also checked and contain no tournament
wording. Old product records retain their historical names; their review notes now say they are retired.

Private exact screenshot backups, original store records and detailed logs are in
`C:/fwc/store-refresh-20261027/`. The backup of App Review Information contains credentials and
must never be committed. Sanitised results are in `qa/evidence/2026-10-27/store-refresh/`.

During the initial metadata refresh no store submission, Google Play edit commit, binary build,
customer entitlement change, historical event deletion or public release was performed.
The subsequent owner-authorised iOS build/upload is recorded separately in `ios-testflight-2026-10-27.md`.
