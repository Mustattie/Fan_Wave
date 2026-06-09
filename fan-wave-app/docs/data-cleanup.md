# Data cleanup playbook

Two SQL scripts in `supabase/scripts/` exist to remove test data from the
**dev / QA** Supabase project (`azkmymxdjylmkytrvyfn`). They are NOT meant
to run against the new prod project — that one starts empty after the
migration replay.

- `cleanup_test_clips.sql` — removes test rows from `media_clips`.
- `cleanup_test_users.sql` — removes test accounts from `auth.users` +
  `public.users` and all their authored rows.

Both default to **dry run**. They wrap everything in a transaction that
ends in `ROLLBACK` so a first execution just shows the preview. To
actually delete, follow the per-script checklist at the bottom of each
file (`section 4. DELETE BLOCK`).

## When to run

### Now (one-time, against dev)

The Play Store-live build (1.0.0 build 3) is still pointed at the dev
Supabase. P0 issue #9 ("test clips visible to new users") is caused by
this. Run both scripts against the dev project before the new prod
project is ready, in this order:

1. `cleanup_test_clips.sql` — removes orphaned content first.
2. `cleanup_test_users.sql` — removes the accounts that authored
   anything that wasn't already swept by step 1.

### Ongoing (each QA cycle)

After every Maestro / manual QA pass on dev, run `cleanup_test_users.sql`
again to keep the QA project tidy. Test accounts created during the
session will be caught by the email-pattern criteria.

### Never against new prod

The new prod project starts clean. These scripts treat any pre-launch
(< 2026-06-07) clip as test data, which would wipe legitimate prod
content if you ever pointed them at the wrong project. Double-check the
SQL Editor's project selector before hitting run.

## What counts as "test data" (criteria summary)

### Test clips (`cleanup_test_clips.sql`)

A clip is deleted if **either**:

- Uploader's `auth.users.email` matches a test pattern (`test`,
  `maestro`, `qa`, `dev`, `+test`, `@example.com`, `@mailinator.com`) or
  is on the explicit known-test list.
- `media_clips.created_at < 2026-06-07 00:00:00 UTC` (Play Store launch
  timestamp — anything older is by definition dev seed or QA).

The reviewer account (`fansphere.reviewer@gmail.com`) is hard-excluded.

### Test users (`cleanup_test_users.sql`)

A user is deleted if **any** of:

- Email matches a test pattern (same list as above).
- Email is on the explicit known-test list.
- `subscription_status IN ('trial','active')` BUT there is no matching
  row in `entitlements` — i.e. someone hand-flipped premium for QA but
  the RevenueCat webhook never confirmed an actual purchase.

The reviewer account is hard-excluded.

The script deletes all rows authored by the user across roughly 25
tables in dependency order, because most of the schema stores `user_id`
as a bare UUID without `REFERENCES users(id) ON DELETE CASCADE` (legacy
from migrations 002–019). See the FK map at the top of the script for
the full table list and order.

## Manual checks BEFORE running the DELETE block

1. **Take a Supabase backup snapshot** (Database → Backups → "Create
   snapshot"). This is the single most important step. Restore is a one-
   click rollback if the script over-deletes.
2. **Run the dry run first.** Read the row counts in the audit metrics:
   - `dry_run_would_delete_total` for clips should match your manual
     estimate of how many test clips you remember uploading.
   - `dry_run_would_delete_users` should be ~ what Maestro+manual tests
     have created since the last cleanup.
3. **Visually spot-check the preview SELECT.** Confirm the reviewer
   account does not appear. Confirm no real prod user (created since
   2026-06-07 with a real email) appears.
4. **Confirm the known-test email list is current.** If new test
   accounts have been created and aren't on the list, add them to the
   `OR au.email IN (...)` block before running.

## Manual checks AFTER running the DELETE block

1. Compare the `pre_cleanup_*` and `post_cleanup_*` audit counts in the
   script output. The delta should equal the dry-run total.
2. Open the live build (Play Store install) and confirm the Clips tab no
   longer shows the test videos. (P0 issue #9 verification.)
3. Confirm the reviewer account still logs in cleanly and still has
   `subscription_status='active'` with `premium_active_until` in 2099.
   If not, re-run `grant_reviewer_premium.sql`.
4. Purge orphaned storage objects: the scripts intentionally do not
   touch the `clips` Supabase Storage bucket. Open Storage → clips and
   delete object keys no longer referenced by any surviving
   `media_clips.media_url`.
5. If any deleted account had a real RevenueCat subscriber record (it
   shouldn't — the entitlements check excludes those), delete the
   subscriber on the RevenueCat dashboard to prevent webhook
   resurrection of the user row.

## Related scripts

- `supabase/scripts/grant_reviewer_premium.sql` — the entitlement
  grant that the cleanup script is designed to preserve. Re-run after
  cleanup only if the reviewer's premium was somehow lost.
