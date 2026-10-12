# Approved production execution — October 12, 2026

Current status: all migrations 101–108 applied and verified; all three prepared function updates deployed with successful runtime checks. Owner subsequently explicitly approved the recommended operational retention while preserving accounts/content and prohibiting manual cleanup. Capacity testing remains stopped on the independently reproduced socket-harness false pass; no paid resize or store submission occurred.

Owner authorization: apply migrations 101–108 and the prepared health-check, process-notification-queue and sync-game-schedules updates; investigate load-test gaps, use staging Small for up to one hour if needed, restore it, stop on failures; no production data deletion or store submission.

Claude reviewed the exact scope read-only and agrees on prerequisites. Codex is the sole production/compute operator. Claude identified scheduled retention in 104/107 and recommended transactional request wrappers for 101–107, bounded index locking, saved live index definitions, and checking shared-secret/gateway configuration. These safeguards were implemented. Claude's response remains locally at C:/fwc/claude-approved-release-review-20261012.txt.

## Applied and verified

| Migration | Result |
| --- | --- |
| 101 | PASS: four kill-switch rows present and all enabled. No production switch was paused. |
| 102 | PASS: fresh duplicate media-URL check zero; quota trigger enabled and unique media-URL index valid. |
| 103 | PASS: required user columns/tier helpers present; eight enabled AFTER INSERT rate-limit triggers; ceiling helpers unavailable to app roles; consumption helper present. |
| 104 | PASS: fresh notification-key duplicate check zero; claiming RPC and lease column present; app-role EXECUTE revoked, service_role allowed; notification deduplication unique index valid; approved retention scheduled. |
| 105 | PASS: storage update policy has both USING and WITH CHECK; storage_gc uses RLS; orphan-recording function present. No blob deletion performed. |
| 106 | PASS: four new workload indexes valid. Old duplicate definitions saved before index cleanup. Games EXPLAIN ANALYZE baseline execution 3.259 ms; bounded transaction completed successfully. |
| 107 | PASS: sync-run table uses RLS, freshness index present; approved retention scheduled. |
| 108 | PASS: postgres-owned SECURITY DEFINER count functions, exact pinned search_path, app-role EXECUTE revoked, two enabled membership triggers, zero count drift. Twelve previously drifted production rooms were reconciled. |

101–107 requests wrapped the unedited reviewed SQL in BEGIN/COMMIT, 5-second lock timeout and 60-second statement timeout. 108 already contains its own transaction/timeouts. Every step had a separate read-only postcheck; no production membership/content fixtures were inserted to test behaviour. 105/106/108 were completed first because they are independent of the retention changes; 103/104/107 followed explicit retention approval.

## Backup and preflight

Schema/function definitions, ownership/ACLs, indexes, policies, triggers and cron metadata are privately saved at C:/fwc/release-approved-20261012/schema-backup.json. Function metadata and deployed sources for all three functions are saved alongside it. Initial CLI download required unavailable Docker; its legacy decoder was incompatible with the deployed bundle. Supabase CLI 2.120.0 was invoked temporarily through npx with its documented --use-api download option; all three source backups succeeded. No application dependency or global CLI installation was changed. Production writes did not begin until backups succeeded.

The edge CRON_SHARED_SECRET digest matches the vault secret used by production cron. Compared digests only; no secret values were printed or committed. All three prepared functions require verify_jwt=false and authenticate inside the function. Their previous source/configuration is saved for rollback. Deployment followed prerequisite 104/107 completion.

## Retention clarification resolved

103 removes expired rate-limit records older than one day probabilistically; 104 schedules purging sent notification-queue records older than 7 days and dead records older than 30 days; 107 schedules purging sync-run records older than 30 days. Owner explicitly approved these recommended retention periods and continuation. The original reviewed SQL was applied without changing retention periods. No manual cleanup or account/content deletion was performed.

104's refreshed uniqueness precheck and 103's eight-column/tier-helper precheck passed before their applies. No duplicate-data deletion was needed or performed.

## Function deployment and runtime verification

| Function | New production version | Verification |
| --- | --- | --- |
| process-notification-queue | 8 | ACTIVE, verify_jwt=false; unauthorized request 401. Two post-deployment scheduled responses returned HTTP 200, success=true, sent/failed/dead/batches all zero. No notification test fixtures or forced pushes were sent. |
| sync-game-schedules | 16 | ACTIVE, verify_jwt=false; unauthorized request 401. Normal scheduled ESPN run finished ok=true: 228 games seen, one written, 227 skipped; sync_runs bookkeeping persisted. |
| health-check | 7 | ACTIVE, verify_jwt=false; unauthorized request 401; authenticated HTTP 200, version2.0.0, overall status ok. Database/auth/storage/realtime/sync freshness/queue/stuck/oldest-pending checks all ok. |

Runtime readback: sync freshness27 seconds, pending/dead/stuck queues zero, member-count drift zero; retention cron entries active. This verifies the empty notification-worker path and scheduled sync, not a newly sent real-device push or every possible ESPN sport. Nightly retention was configured and not manually invoked. Signed mobile candidate/UAT gates remain separate.

## Capacity work in progress

Confirmed gaps: one shared chat room for all writers/subscribers, no presence tracking, and no previously retained load-generator resource evidence. Recovered existing600 staging users. Token preparation honored server 429 backoff, then was explicitly stopped when harness validation found the defect below; no k6 run started. This is auth setup, not a capacity-test pass/fail result. A socket-only baseline/campus/spike diagnostic runner was prepared with host CPU, free memory, process working set and connection-count samples, but is held until the harness is corrected. Presence and distributed-room results cannot be inferred from the existing scripts, and no larger compute tier is a proven fix.

**Load-validation STOP:** a deterministic synthetic reproduction against the actual runSocket function sends two successful phx_reply acknowledgements followed by system status=error, message="Too many database timeouts". The socket closes, but runSocket returns joinedAll=true and records ws_join_ok=1. Once joinMs is set, the system-error path does not invalidate it. Evidence: qa/evidence/2026-10-12/approved-production/socket-system-error-proof.json. The reproduction made no remote request. Earlier paired600 failures remain failures; this flaw means the recorded join metric can overstate reliability, not that it rescues the failed run. Do not spend paid compute or claim a new capacity pass until failure/subscription-confirmation accounting is corrected and behavior-tested.

No paid resize or store submission has occurred in this execution checkpoint. Production writes performed above contain no user-account/content deletion. Store/iPhone/Android-device gates remain separate.
