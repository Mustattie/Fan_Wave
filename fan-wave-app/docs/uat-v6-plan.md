# Fan Sphere v6 — UAT End-to-End Test Plan

**Release:** Bug-fix bundle v6 (RLS recursion, Soccer Cup tab queries, NavigationGuard idle-resume, venue search, keyboard avoidance, account deletion, Soccer Cup rebrand)
**Targets:** Apple App Store (build 7+) + Google Play (AAB v4+)
**Author:** UAT Analyst
**Date:** 2026-06-10

## Assumptions

- Production Supabase project: `fwlfiejvxmslkpoojggs` (per `project_prod_env_single_supabase.md`)
- Reviewer / shared test account: `fansphere.reviewer@gmail.com` (RevenueCat sandbox, Play, ASC)
- EAS production profile + Resend SMTP (`no-reply@fansphere.org`) already configured
- Migrations 051 (RLS helpers) and 047 (suggest_fan_groups RPC) are applied to prod
- Sentry DSN is still `__SET_PROD_SENTRY_DSN__` placeholder — release notes must flag this
- Push notification keys are deferred (no APNs/FCM token tests in scope this release)
- Test devices: iPhone 14 (iOS 17), iPhone SE 2nd gen (iOS 16, small screen), Pixel 7 (Android 14), Pixel 4a (Android 13)
- Network conditions: WiFi, LTE, throttled 3G (via Charles/Network Link Conditioner)

---

## Severity Legend

- **S1 Blocker** — Ship-stopper, must pass before submit
- **S2 High** — Significant degradation, fix before next build
- **S3 Medium** — Cosmetic / partial, track in backlog
- **S4 Low** — Nice-to-have

---

## A. Smoke Tests (every release)

| ID | Scenario | Steps | Expected | Severity | Platform |
|---|---|---|---|---|---|
| SMOKE-001 | Cold launch | Force-stop app, relaunch from springboard/launcher | App reaches Home or Sign-in within 4s, no white screen, no Sentry crash | S1 | Both |
| SMOKE-002 | New-user sign-up | Sign up with fresh `+uat@` Gmail alias → verify email via Resend → onboard → land on Home | Email arrives within 60s from `no-reply@fansphere.org`; onboarding 3 screens; lands on Home (not Subscription) | S1 | Both |
| SMOKE-003 | Returning sign-in | Kill app from background → reopen → user already signed in | Resumes on Home / last-viewed tab (Soccer Cup, Discover, Profile) — NOT Subscription | S1 | Both |
| SMOKE-004 | Soccer Cup tab subtabs | Tap Soccer Cup tab → swipe Schedule, Watch Parties, Fan Groups | All three subtabs load, no infinite spinner, no "World Cup" / "FIFA" text anywhere | S1 | Both |
| SMOKE-005 | Create fan group | Soccer Cup tab → Fan Groups → "+" → "Brazil Crew" → Save | Group created; no RLS error toast; appears in Fan Groups list within 2s | S1 | Both |
| SMOKE-006 | Post a clip | Home → Compose → upload 10s mp4 → caption → Post | Clip appears at top of feed instantly with "Uploading" pill; transitions to "Live" within 30s | S2 | Both |
| SMOKE-007 | Create + RSVP watch party (Dallas) | Soccer Cup tab → Watch Parties → "+" → Brazil vs Argentina → search venue "Dallas" | Venue list returns ≥5 results within 30 km; create succeeds; party appears in Soccer Cup Watch Parties subtab | S1 | Both |
| SMOKE-008 | Account deletion entry point | Profile → Settings → Account → Delete Account | Confirm screen appears with 2-step typed confirmation | S1 | Both |

---

## B. Regression Tests — 10 Targeted Bug Fixes

### Bug 1 — RLS infinite recursion blocking fan group creation (migration 051)

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-001 | Sign in as User A → create fan group "Test1" | Group inserts, no `infinite recursion detected in policy` error in Sentry / logs | S1 | Both |
| REG-002 | User A invites User B → User B accepts | Membership row inserts; B sees group on their Soccer Cup → Fan Groups subtab | S1 | Both |
| REG-003 | User B (member) creates a post in group → User A reads it | Post visible to A; no recursion error in `pg_logs` | S1 | Both |
| REG-004 | Concurrent: 3 users create groups simultaneously | All 3 succeed, no 500s; verify in Supabase `fan_groups` table | S2 | Both |

### Bug 2 — Soccer Cup Watch Parties query uses `event_id`

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-005 | Open Soccer Cup → Watch Parties subtab with 0 parties seeded | Empty state renders, no SQL 42703 (column does not exist) in logs | S1 | Both |
| REG-006 | Seed 1 party with valid `event_id` → reopen subtab | Party appears with correct match name + kickoff time | S1 | Both |
| REG-007 | Filter by date (next 7 days) | Only parties whose linked event falls in window appear | S2 | Both |

### Bug 3 — Create Watch Party from Soccer Cup tab stamps `event_id` + `sport_id`

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-008 | Soccer Cup tab → "+" → pick Brazil vs Argentina → create | Row in `watch_parties` has non-null `event_id` AND `sport_id=soccer` | S1 | Both |
| REG-009 | Same flow, then refresh Soccer Cup → Watch Parties subtab | Newly created party appears immediately in tab list | S1 | Both |
| REG-010 | Create same party type from generic Discover tab | `event_id` may be null but `sport_id` populated correctly | S2 | Both |

### Bug 4 — NavigationGuard idle-resume no longer reroutes free-tier to Subscription

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-011 | Sign in as free-tier user → open Soccer Cup tab → background app 45 min → reopen | Returns to Soccer Cup tab. Does NOT show Subscription paywall | S1 | Both |
| REG-012 | Same, but for Premium subscriber (trial active) | Returns to last screen; no paywall reshown | S1 | Both |
| REG-013 | Free-tier + 8h overnight background | Sign-in still valid; resume on last tab | S2 | Both |
| REG-014 | Soccer Cup Pass holder (one-time IAP) backgrounds during match | Resumes on Soccer Cup tab, pass still active | S1 | Both |

### Bug 5 — Venue search uses 30 km radius + Overpass server-side regex

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-015 | Create Watch Party → venue search "Pub" in Dallas downtown | Results include venues up to 30 km out (Plano, Irving), not just within 3 km | S1 | Both |
| REG-016 | Search "Buffalo Wild Wings" | Server-side regex returns BWW branches; partial matches like "Buffalo" do not over-flood | S2 | Both |
| REG-017 | Empty city (Wyoming small town) | Returns nationwide fallback per Bug 6, not an empty list | S2 | Both |
| REG-018 | Overpass timeout simulation (Charles block) | Graceful "Try again" toast; no crash | S2 | Both |

### Bug 6 — Discover "Watch Parties Near You" broadens to nationwide when local empty

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-019 | Set device location to remote area with 0 parties | Section header switches to "Watch Parties Across the US"; shows ≥3 results | S1 | Both |
| REG-020 | Set location to NYC with active parties | Local section first, no broadening triggered | S2 | Both |
| REG-021 | Pull-to-refresh fires query again | No duplicate rows, no flicker | S3 | Both |

### Bug 7 — Keyboard avoidance + safe-area on Create Fan Group / Watch Party

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-022 | Create Fan Group → tap description field on iPhone SE | Field stays visible above keyboard; Save button reachable | S1 | iOS |
| REG-023 | Create Watch Party → scroll to bottom on Pixel 4a | Bottom CTA not clipped by gesture nav bar | S1 | Android |
| REG-024 | Rotate to landscape mid-input | Layout reflows; no overlap | S3 | Both |

### Bug 8 — Clip post optimistic insert (in flight)

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-025 | Post clip with airplane mode ON | Clip appears in feed with "Uploading" badge; queued for retry | S2 | Both |
| REG-026 | Airplane OFF → upload completes | Badge transitions to "Live"; row updates without flicker | S2 | Both |
| REG-027 | Force-kill mid-upload | On relaunch, clip shows "Failed — retry" affordance | S3 | Both |

### Bug 9 — Soccer Cup rebrand (Apple Guideline 5.2.1)

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-028 | Grep entire compiled bundle for "World Cup", "FIFA" | Zero hits across UI strings, screenshots, listing copy | S1 | Both |
| REG-029 | Soccer Cup Pass IAP product listing | Title = "Soccer Cup Pass"; description has no FIFA/World Cup | S1 | Both |
| REG-030 | Push notification copy templates | No restricted terms | S2 | Both |

### Bug 10 — In-app account deletion (Apple Guideline 5.1.1(v))

| ID | Steps | Expected | Severity | Platform |
|---|---|---|---|---|
| REG-031 | Profile → Settings → Account → Delete Account → type "DELETE" → confirm | Account soft-deleted within 5s; signed out; re-sign-in fails | S1 | Both |
| REG-032 | Try sign-in with deleted account | Receives "Account not found" or recovery window message | S1 | Both |
| REG-033 | Active subscription holder deletes account | Sub remains in RevenueCat but app access revoked; warning shown pre-delete | S2 | Both |
| REG-034 | Verify DB state: `users.deleted_at` populated; PII anonymized | Email scrubbed to `deleted+<uuid>@fansphere.org` | S1 | Both |

---

## C. Stress / Load Tests (100-concurrent simulation)

### C.1 — 100 simultaneous clip uploads

- **Approach:** k6 script hitting Supabase Storage signed-upload endpoint with 100 VUs, each posting a 2 MB mp4. Run from a single CI runner (GitHub Actions Ubuntu) targeting prod-but-test-tenant.
- **Manual augmentation:** TestFlight cohort of 20 internal testers + Maestro fan-out across 5 emulators simulating 80 client-side posts via the actual RN flow.
- **Pass criteria:** p95 upload < 12s; 0 RLS errors; Supabase Storage egress < 80% of Pro tier quota.
- **ID:** LOAD-001

### C.2 — 100 concurrent chat messages in one fan group

- **Approach:** Node script using `@supabase/supabase-js` with 100 service-key-scoped clients spamming `INSERT INTO messages` in a single group_id over 30s.
- **Pass criteria:** All 100 messages arrive in Realtime subscription on observer client within 3s of insert; no dropped frames in Flipper trace.
- **ID:** LOAD-002

### C.3 — Realtime lag detection

- **Approach:** Observer device subscribes to `messages:group_id=eq.<id>`; emit `client_send_ts`; on receive, log `now - server_inserted_at`.
- **Threshold:** Lag > 1500ms p95 = FAIL. Dashboard via Grafana hitting Supabase logs export.
- **ID:** LOAD-003

### C.4 — Supabase Pro tier limit detection

- **Watch metrics:** Connections (cap 200), egress (250 GB/mo), DB CPU, Realtime concurrent (500). Alert at 70%.
- **Tooling:** Supabase dashboard → Reports → Usage; set Slack alert via webhook.
- **ID:** LOAD-004

---

## D. Apple / Play Review Dry Run

### D.1 — Reviewer walkthrough script

1. Launch app cold.
2. Sign in with `fansphere.reviewer@gmail.com` / `<password-in-review-notes>`.
3. Land on Home; tap Soccer Cup tab; demonstrate Schedule, Watch Parties, Fan Groups.
4. Tap "+" on Watch Parties → create demo party at "Lone Star Pub, Dallas" → save.
5. Open Profile → Subscription → show Premium monthly, Premium yearly, Soccer Cup Pass tiles.
6. Profile → Settings → Account → Delete Account → walk through (do NOT confirm — show the screen).
- **ID:** REVIEW-001

### D.2 — IAP visibility test

- Sign in as reviewer → Subscription page → confirm all 3 SKUs render with localized prices.
- Tap Premium Monthly → RevenueCat paywall opens → close.
- **Pass:** No "Product not available" string.
- **ID:** REVIEW-002

### D.3 — Account deletion screen recording

- Record 30s screen recording (iOS Control Center → Screen Record) of: Profile → Settings → Account → Delete Account → confirm screen → final delete → forced sign-out.
- Upload to ASC reviewer notes for build 7.
- **ID:** REVIEW-003

### D.4 — Screenshot capture sequence (8 listing)

1. Home feed with clips
2. Soccer Cup tab — Schedule
3. Soccer Cup tab — Watch Parties subtab
4. Watch Party detail page
5. Fan Group chat
6. Create Watch Party (venue picker)
7. Discover — Watch Parties Near You
8. Subscription page
- **All must:** show "Soccer Cup" (never World Cup / FIFA), iOS-only chrome (no Android nav bar in iOS bucket), reviewer demo data.
- **ID:** REVIEW-004

---

## E. Pre-Production Checklist

| ID | Item | Verified by | Status field |
|---|---|---|---|
| PRE-001 | `eas.json` production profile has `EXPO_PUBLIC_SUPABASE_URL` pointing to `fwlfiejvxmslkpoojggs` | Grep eas.json | ☐ |
| PRE-002 | `EXPO_PUBLIC_SUPABASE_ANON_KEY` matches prod publishable key | Supabase dashboard | ☐ |
| PRE-003 | RevenueCat API key = production (not sandbox) | RC dashboard | ☐ |
| PRE-004 | Resend SMTP active; sender `no-reply@fansphere.org` verified DKIM/SPF | Resend dashboard | ☐ |
| PRE-005 | ASC License Agreement signed; Paid Apps Agreement Active | App Store Connect → Agreements | ☐ |
| PRE-006 | All 3 IAP products in ASC = "Ready to Submit" or "Approved" | ASC → In-App Purchases | ☐ |
| PRE-007 | Play Console subscriptions + Soccer Cup Pass = Active | Play Console → Monetize | ☐ |
| PRE-008 | Push keys (APNs `.p8` + FCM `google-services.json`) — DEFERRED, flag in release notes | N/A | ☐ DEFERRED |
| PRE-009 | Sentry DSN replaced from `__SET_PROD_SENTRY_DSN__` placeholder | Grep app.config / env | ☐ BLOCKER if shipping |
| PRE-010 | `autoIncrement: true` + `appVersionSource: "remote"` on preview + production EAS profiles | eas.json | ☐ |
| PRE-011 | Migrations 047 + 051 applied to prod Supabase | `supabase__list_migrations` | ☐ |
| PRE-012 | ESPN sync pg_cron jobs active (5-min + 1-min) | Supabase → cron | ☐ |
| PRE-013 | Run local validation gauntlet (lint + tsc + jest + maestro smoke) before EAS build | CI | ☐ |
| PRE-014 | Reviewer notes updated in ASC + Play with reviewer entitlement bypass instructions | ASC / Play | ☐ |

---

## F. Post-Deployment Monitoring (first 24h)

### F.1 — Supabase dashboard

| ID | Metric | Threshold | Action if breached |
|---|---|---|---|
| MON-001 | DB connections | < 70% of 200 cap | Scale up + investigate connection leak |
| MON-002 | Slow query log (>1s) | < 10/hr | Check missing indexes; advisors |
| MON-003 | RLS errors | 0 (esp. recursion) | Hotfix migration |
| MON-004 | Storage egress | < 70% Pro quota | Throttle clip resolution |
| MON-005 | Realtime channels open | < 70% of 500 cap | Audit unclosed subscriptions |
| MON-006 | Auth failures > 5%/hr | Investigate Resend, captcha | |

### F.2 — RevenueCat dashboard

| ID | Metric | Threshold |
|---|---|---|
| MON-007 | New trial starts | Track conversion baseline |
| MON-008 | Sandbox vs prod traffic split | 100% prod traffic on app users |
| MON-009 | Refund rate | < 2% |
| MON-010 | Pass purchases (Soccer Cup) | Trending positive |

### F.3 — Crash reports (Sentry)

- Crash-free sessions > 99% for first 24h
- Top issues triaged into Linear within 2h of report
- Alert any new event with > 5 occurrences in 30 min

### F.4 — User-reported issues triage flow

1. In-app feedback or App Store review → Linear ticket auto-created (Zapier)
2. Severity tagged within 1h (P0/P1/P2/P3)
3. P0/P1 → on-call Slack channel
4. Daily standup: review yesterday's incoming
5. Reply to reviews within 24h with status

---

## Execution Order Recommendation

1. **Day -3:** Run full PRE-001 → PRE-014 checklist; resolve all BLOCKERs (especially Sentry DSN)
2. **Day -2:** Run SMOKE-001 → SMOKE-008 on all four target devices
3. **Day -2 evening:** Run REG-011 through REG-014 (NavigationGuard idle-resume) — leave devices overnight
4. **Day -1:** Run remaining REG suite + LOAD-001 → LOAD-004 against staging
5. **Day -1:** Record REVIEW-003 (account deletion video); capture REVIEW-004 (8 screenshots); update reviewer notes
6. **Day 0:** Submit to ASC + Play
7. **Day 0 → +1:** Active MON-001 → MON-010 monitoring; on-call rotation

---

## Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| UAT Lead | | | |
| Product Owner | Mustafa Musa | | |
| Eng Lead | | | |

*End of plan — v6.0 — 2026-06-10*
