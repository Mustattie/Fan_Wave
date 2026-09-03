# Tier promises vs. what the system actually does

Audit date **2026-08-31**, against `HEAD` and prod `fwlfiejvxmslkpoojggs`.

Every bullet the paywall shows a user, traced to the code or policy that
delivers it. Source of the promises: `TIER_CONFIG` in
`components/paywall/PremiumPaywall.tsx` (lines 44-83), echoed in
`app/(auth)/choose-plan.tsx` and in the store product descriptions.

**Result: 1 of 11 promises is enforced.**

---

## Home Team — $4.99/mo · $34.99/yr

| Promise | Status | Evidence |
|---|---|---|
| Unlimited clip posting | **ENFORCED** | `check_clip_quota` (mig 083); free = 3 per rolling 24h, `home_team`+ = 9999. Called pre-upload at `app/create-clip.tsx:270`. Verified on prod: a free user returns `{cap:3}`, reviewer returns `{cap:9999}`. |
| Unlimited fan groups | **NOT ENFORCED** | Mig 070 dropped the free-tier quota from `chat_rooms_insert`. No client-side cap either. On prod a **free user already owns 5 groups**. |
| Public + private watch parties | **NOT ENFORCED** | The public/private toggle at `app/create-watch-party.tsx:1352` has no tier check, and `watch_parties_insert` lost its gate in mig 070. Free users can create private parties today. |
| Home Team badge on your profile | **PARTIAL — self-visible only** | `app/(tabs)/profile.tsx:228` renders the tier label as a badge on the **Subscription menu row of your own profile screen**. No other user ever sees it. A badge nobody else can see is not a badge. |
| Priority search visibility | **NOT IMPLEMENTED** | The string "priority" appears in `PremiumPaywall.tsx` and `choose-plan.tsx` and nowhere else in the codebase. No search or ranking code reads tier. |
| Ad-free experience | **VACUOUS** | There is no ad SDK in the project — no AdMob, no ad units, no ad rendering anywhere. Nobody sees ads, so nobody is buying their removal. Not false; not a benefit. |

## MVP — $14.99/mo · $99.99/yr

| Promise | Status | Evidence |
|---|---|---|
| Everything in Home Team | **TRUE, inherits the above** | `mvp` products attach to the `home_team` entitlement; `tier_rank('mvp') > tier_rank('home_team')`. Correct — but it inherits a list that is mostly unenforced. |
| Advanced audience analytics | **NOT GATED** | `app/creator-stats.tsx` calls `get_creator_stats` with no tier check of any kind, and Profile routes every user to it (`profile.tsx:178`). Free users have the full analytics screen. |
| Verified creator badge | **NOT IMPLEMENTED** | "verified" appears only in paywall copy and in the email-verification flow, which is unrelated. |
| Featured placement in Discover | **NOT IMPLEMENTED** | "featured" appears only in `PremiumPaywall.tsx`. Discover's ranking never reads tier. |
| Brand collaboration inbox | **NOT IMPLEMENTED** | "brand" appears only in `PremiumPaywall.tsx`. No table, no screen, no route. |

## Server-side enforcement, in total

```sql
SELECT ... FROM pg_policies
WHERE qual LIKE '%has_premium_access%' OR qual LIKE '%has_tier_or_higher%';
-- 0 rows
```

Not one RLS policy on prod references tier. `PaywallGate.tsx` — the component
built to gate features — is **imported by nothing**. `useHasTierOrHigher` is
called only inside that dead component. The tier system is fully built,
correct, and load-bearing for exactly one feature.

---

## How it got here

Two changes moved in opposite directions and never met.

**Mig 070 (2026-07-18)** deliberately removed the gates on creation flows,
acting on direct UAT feedback: *"These pymt screens are supposed to come up
upon signing in, not when one is trying to create a fan group or watch
party."* That was the right call and should not be reverted — see
`feedback_paywall_placement`.

**v9.3 (2026-08-06)** then wrote tiered paywall copy describing the
pre-070 world, and added four *new* promises — priority search, verified
badge, featured placement, brand inbox — that were never built at all.

Nobody reconciled the copy with the gates, because nothing forces them to
agree.

## Why this needs fixing before the next submission

- **App Store review.** Guideline 2.3.1 (accurate metadata) and 3.1.2. A
  reviewer who buys MVP and looks for the verified badge, featured placement,
  and brand inbox will not find them. This is a rejection the reviewer can
  reach in two minutes.
- **Refunds and chargebacks.** A user paying $14.99/mo for five bullets,
  four of which do not exist, has a straightforwardly good case.
- **It is the v9.4.5 defect again, one level up.** That release fixed the
  paywall claiming a price the store would not charge. This is the paywall
  claiming features the app does not have.

## Recommendation

Two honest paths per row: build it, or stop selling it. What follows is the
cheapest split that leaves both tiers with real value and keeps mig 070's
decision intact — **no new gates on creation flows.**

**Home Team**
- Keep: unlimited clip posting (already real, and it is a genuine limit users hit).
- Build (small): make the Home Team badge **publicly visible** — on clip cards,
  group member lists, and watch-party attendee rows. It is a display change
  over a column that already exists, and it makes the badge mean something.
- Cut from copy: "Unlimited fan groups" (free already has it), "Public +
  private watch parties" (free already has it), "Ad-free experience"
  (no ads exist), "Priority search visibility" (unbuilt).

**MVP**
- Build (small): gate `app/creator-stats.tsx` behind `mvp`. This is a *view*
  gate, not a creation gate, so it does not reopen the July argument — and it
  makes "advanced audience analytics" true immediately.
- Cut from copy for now: "Verified creator badge", "Featured placement in
  Discover", "Brand collaboration inbox" — or build them and keep them. They
  are real features worth having; they are just not features we have.

Whatever is cut from `TIER_CONFIG` must also be cut from
`app/(auth)/choose-plan.tsx` and from both stores' product descriptions,
which carry the same list.
