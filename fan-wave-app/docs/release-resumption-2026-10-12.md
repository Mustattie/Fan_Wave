# Release resumption — October 12, 2026

Later execution status: owner authorized the backend and bounded staging work. See [production execution](production-execution-2026-10-12.md) for live results; 101/102/105/106/108 are applied and verified, while operational-retention clarification holds 103/104/107 and dependent function updates. The inventory below is the pre-execution snapshot.

Owner asked Codex to communicate the reconciled status to Claude and finish the remaining work. The owner's friend will perform physical iPhone UAT. Both Android and iOS remain required. Release status remains NO-GO.

## Work completed today

- Fetched origin. Product fixes and emulator closure are already on origin/v9.5 at 57cf4e6. Local f77bdec adds three documentation commits only; the product source is unchanged.
- Attempted continuation of Claude session 2a81a4f6-2ec8-4e52-8760-6f3e63648643 with the full handoff. CLI again returned "Credit balance is too low". No new acknowledgement or accepted assignment exists. Attempt output: C:/fwc/claude-release-coordination-20261012.txt.
- Verified production and staging through read-only Management API queries. Both report ACTIVE_HEALTHY. Saved dated backend inventory and comparison under qa/evidence/2026-10-12.
- TypeScript passed. Both CI Jest presets passed 35 suites / 302 tests and exited zero. Existing worker teardown warning and nested Claude-worktree package naming warning remain; no assertion failed.
- Re-ran the scratch-PostgreSQL migration harnesses: 108 passed all 73 checks; 103 passed grammar, behaviour, concurrency, idempotency, reversal and re-application checks. These are local tests, not production deployment evidence.
- Restored EAS read access using the project's existing ignored .env.eas token. The desktop's default EAS account lacks project access; no login or stored credentials were changed.
- Found existing Android preview Build 35, finished October 6 at 20:57 UTC, build ID 46026cac-4b17-4e68-aaa1-698eab5fccb7, commit 57cf4e6f9c74a94f52cde841ef7304ec759de95b. This supersedes the earlier assertion that no final Android candidate exists. It does not retrospectively establish its pre-build gate or device smoke.
- Downloaded Build 35 to C:/fwc/fansphere-build35.apk. APK signature verification passed (v2); package org.fansphere.app, versionCode 35, versionName 1.0.0. SHA-256 B57AD0B4CD9DEF2FE5286A58EE329EA49E96E394E28EA35F73FD2D292138647E. Signer certificate SHA-256 84de16e97f4ef05b8625b3db2706fd1dff22824723833c71b319164fc42eaa54. Comparison with an approved signing identity and the final store AAB remain open.
- ADB reports no connected devices. Actual signed-candidate install/regression is pending; earlier Galaxy S10+ Build 33 passes and October 3 exceptions remain valid.

## Backend findings and concrete deployment scope

The production migration ledger still ends in historical 063-era entries. It is stale: later deployed objects exist. Do not infer missing migrations solely from ledger entries, run db push, or replay 064–108 indiscriminately.

Live production checks confirm the following gaps against prepared source and staging:

| Prepared change | Current production finding | Required sequence |
| --- | --- | --- |
| 101 kill-switch rows | clips_upload, chat_send, games_realtime and presence rows absent | Insert enabled defaults; verify all four rows remain true. Do not pause production features for UAT. |
| 102 quota enforcement/deduplication | enforce_clip_quota absent; media_clips_media_url_key absent; duplicate non-null media URLs = 0 | Refresh duplicate precheck immediately before apply; install and verify quota trigger, identity handling and unique index. |
| 103 server rate ceilings | rate_limit_ceiling, rate_limit_consume and enforce_insert_rate_limit absent | Apply reviewed tier-aware source after 102; verify eight AFTER INSERT triggers, role bypass and helper permissions. Local harness passes. |
| 104 queue claiming/deduplication | claim_notification_batch and claimed_at absent; notification-log unique index absent; duplicate non-null notification keys = 0 | Refresh duplicate precheck immediately before apply; require separate approval if deduplication deletes become necessary. Apply SQL before deploying its prepared queue worker. |
| 105 storage hardening | storage_gc and record_clip_assets_for_gc absent | Verify storage policy before/after; apply ledger/trigger. This step does not delete blobs. |
| 106 indexes | Four prepared workload indexes absent in the comparison | Confirm each exact definition against source; apply index changes with monitoring. |
| 107 sync-run logging | sync_runs absent | Apply table/functions/retention before the prepared schedule-sync function. |
| 108 member counts | Both production functions are SECURITY INVOKER with unpinned search_path and application EXECUTE; 12 rooms drift | Apply the exact reviewed transaction; verify security, two enabled triggers and zero drift. Staging already has the corrected functions and zero drift. |

Function hash differences in the evidence are investigation leads, not proof every differing function needs deployment; formatting and environment substitutions may differ. Missing objects above are directly observed.

Production health-check currently has gateway verify_jwt=true while prepared config pins false and authenticates inside the function. Deployed health-check, process-notification-queue and sync-game-schedules must be reconciled with prepared source and prerequisite migrations. Cross-project function version numbers are not code identities. Capture existing deployed source/configuration for rollback before deploying replacements. Preserve secrets and project-specific endpoints.

For 108 specifically, the concrete reviewed artifact is supabase/migrations/108_member_count_triggers_security_definer.sql. It contains BEGIN/COMMIT, a 5-second lock timeout, 60-second statement timeout, postgres-owned SECURITY DEFINER functions, pinned search_path, revoked app EXECUTE, trigger reassertion and count reconciliation. Its executable reversal is in the footer. Run the post-apply read-only verification for definitions/ownership/permissions/triggers and count drift. Do not test membership mutations on production to prove behaviour; use the passed scratch/staging evidence.

No production SQL write or Edge Function deployment has been performed today. Existing owner-specific production controls remain in force.

## Capacity investigation and rerun

The previous paired600 failure remains: chat errors 1.827%, join success 95.160%, with Realtime database-timeout messages. Do not weaken thresholds or relabel it a pass. A larger database alone is not a demonstrated fix.

Recovered the existing 600-user fixture pool, result files and ignored .env.loadtest in .claude/worktrees/phase2-migration103/fan-wave-app. Shared-checkout preflight has no local fixture pool, so use explicit absolute fixture/token paths when running current committed scripts. Read-only checks confirm staging schema requirements and games/messages publication. The old tokens are expired. Refresh tokens at the documented 5 requests/second before testing; never print them.

Proposed bounded rerun: use only azkmymxdjylmkytrvyfn, temporarily restore the previously tested Small tier for at most one hour, run unchanged baseline then campus gates and only then the paired600 spike. Capture host CPU/RAM/network, database connection/CPU peaks and Realtime timeout/join errors alongside every summary; run chat and socket processes together. Stop at the first failed profile, preserve failure evidence, restore the original compute tier, and remove only explicitly labelled fixtures created for this run. Existing load users can be reused; do not delete or reseed them unnecessarily. Paid compute resizing is pending explicit owner authorization. Production load testing is excluded.

## iPhone and Android handoff

Friend owns the physical execution; Codex owns candidate identity and technical/backend/telemetry assistance. See docs/iphone-uat-handoff-2026-10-12.md and qa/p3.7-ios-device-uat.md.

EAS lists the latest finished iOS build as production Build 36 from September 16, commit 75d73d10e0daa03e2b5d825a2e6531a077575799. It predates the final fixes and cannot close current P3.7. A new iOS candidate is required after the pre-build gates. Internal distribution needs the friend's registered device; TestFlight needs a store-signed build and beta distribution. No new build, beta upload or store submission was started today.

Android can reuse existing Build 35 for the targeted candidate check: identity/backend, launch/auth replay, Clips retention, Discover outage recovery, pending retry cards, typed/query-URL and legacy video previews, and telemetry. This is not a request to repeat all Build 33 UAT. Preview uses production Supabase and staging telemetry tags; never toggle its global production kill switches for this check. APK verification does not verify a production AAB.

## Remaining controls

1. Explicit production authorization for the prepared migration/function scope; refresh prechecks and retain rollback evidence before each step.
2. Explicit authorization for the bounded paid Small-tier capacity rerun; a green paired600 result is still required for the recommended unrestricted launch.
3. Complete pre-EAS evidence and build GO before a new iOS candidate; settle distribution/device access and deliver it to the friend.
4. Record friend results and Android targeted regression, then verify store artifacts and obtain production submission/rollout approval.

No gate is marked passed merely because an owner or tester has been assigned. No full emulator UAT rerun is needed.
