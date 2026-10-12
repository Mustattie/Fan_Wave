# Production readiness coordination — October 6, 2026

October 12 live status supersedes this historical checkpoint: see [release resumption](release-resumption-2026-10-12.md). Existing Android Build 35 has been located and its APK signature verified; iPhone UAT is assigned to the owner's friend, but needs a new candidate. Current backend gaps remain open.

Status: NO-GO pending backend evidence, build gate completion and owner decisions. Emulator UAT is closed; see uat-closure-2026-10-06.md. Product source baseline 57cf4e6. Documentation commits after this baseline do not change the tested source.

## Coordination status

The owner authorized coordination with Claude. A read-only continuation of Claude's previous UAT session was attempted on October 6; CLI exited with "Credit balance is too low". No fresh Claude acknowledgement or backend review was obtained. Do not treat the work allocation below as an accepted assignment. Claude can resume from the handoff in codex-sync-2026-10-03.md when available. No credentials were changed to work around the failure.

## Work allocation and exit evidence

| Work | Proposed owner | Required closure evidence | State |
| --- | --- | --- | --- |
| Backend migration/deployment readiness | Claude / authorized backend operator | Current production migration inventory; 108 application and included verification results; member counts reconciled, function ownership/search_path/EXECUTE permissions checked; current RPC/schema/RLS and prepared deployment checks; recorded rollback procedure | Pending; earlier production permission rejection remains respected |
| Capacity acceptance | App owner | Explicit acceptance of the 300-user campus envelope and scaling trigger, or remediation plus paired 600-user passing evidence | Decision pending |
| Release platform scope | App owner | Android and iOS confirmed; all fixes must support both platforms | Confirmed October 6 |
| Pre-EAS phases 0–7 | Codex with backend/device operator evidence | Dated phase-by-phase evidence under qa/pre-eas-build-checklist.md; exact release commit and branch; owner confirmation of green phases | Incomplete; not inferred from emulator closure |
| Signed Android candidate | Build operator / Codex | Profile, backend, source commit, remote version, build ID, artifact SHA, signing identity, install result and targeted smoke | **Superseded 2026-10-06: the artifact exists.** Build 35, EAS `preview` id 46026cac-4b17-4e68-aaa1-698eab5fccb7, source `57cf4e6`, remote versionCode 35, FINISHED 2026-10-06T20:57:14Z, keystore `Build Credentials ge57Vm2KOk`, pay-as-you-go; Claude queued it on the owner's instruction. Artifact verified by Codex 2026-10-12 (APK v2 signature, SHA-256 and signer fingerprint in `release-resumption-2026-10-12.md` and the Build 35 row of `device-uat-history.md`). Its pre-build gate provenance is recorded in `codex-sync-2026-10-03.md`. Still open: install and targeted regression, approved-signing-identity comparison, and the production AAB |
| Physical iPhone P3.7 | Device tester (owner's friend, assigned 2026-10-12) / Codex | Actual iPhone/build identification and all 31 rows with evidence or explicitly accepted exceptions | Pending, and no current candidate exists: EAS lists the newest finished iOS build as production Build 36 from 2026-09-16, which predates every final fix. A new iOS candidate is required after the pre-build gates, plus a settled distribution route (internal distribution needs the tester's device registered; TestFlight needs a store-signed build and beta distribution). Handoff in `docs/iphone-uat-handoff-2026-10-12.md` |
| Production submission and rollout | Release operator / owner | Store artifact and version verified, approved rollout scope, rollback/monitoring owner, post-release smoke | Pending after preceding gates |

## Already verified build configuration

On October 6, eas.json has cli.appVersionSource=remote, requireCommit=true, preview.autoIncrement=true and production.autoIncrement=true. Preview is an internally distributed APK; playstore-preview and production produce store AABs. Preview points at production Supabase while telemetry is tagged staging. Production telemetry is tagged production. No .easignore exists in either repository or app root. No retired wc_pass_2026 reference was found in app/components/lib. Shared source is on v9.5, so the checklist's main-branch gate remains unresolved until the intended release branch/commit is approved and integrated. Do not push main merely to satisfy this check: its CI may initiate a paid build.

Remote preview Sentry DSN was previously verified usable. Production environment, signing/submission credentials, current remote build numbers, store access and artifact availability still require verification; no secret values belong in evidence. Preview APK evidence alone does not verify the final production AAB.

## Signed-candidate regression walk

1. Confirm artifact identity, backend and telemetry environment before exercising account flows.
2. Walk five-tab/pivot sanity and the complete Phase 4 checklist on the actual signed artifact.
3. Authenticate, replay the auth handoff and reconnect after an outage. Check single auth consumption, expected presence emissions and stable channel cleanup.
4. Open video previews with explicit video metadata and signed/query URLs; exercise legacy null-media-type records and image previews; close/reopen without stale playback.
5. Post a clip, verify picker-copy cleanup; restart a queued upload and exercise retry-card retention across feed replacement. Kill-switch testing requires a separately authorized safe backend; do not toggle the global production flag to reproduce staging tests.
6. Verify populated Discover remains usable through refresh/outage/recovery; watch-party creation, linked-game selection, RSVP and cancellation reconcile with server state.
7. Recheck retained Views while switching Clips filters, cached loops and memory stability; review new Sentry errors after the walk. Retain prior long-soak evidence unless a candidate regression invalidates it.
8. Remove only labelled authorized test fixtures; capture post-build Phase 8 and store-ready AAB verification separately from the preview APK.

## Next handoff

Claude: reconcile the closure record, provide the current backend inventory and deployment plan, and identify any missing gate. Keep production changes and paid builds behind their existing controls. Codex: maintain this matrix, collect missing pre-EAS evidence and execute candidate smoke once an approved signed artifact is available. No emulator work should be repeated solely because the previous Claude conclusion predates the final handback.

## Owner scope confirmation and capacity recommendation

October 6: owner confirms production release includes both Android and iOS, and every fix must work on both. Shared implementations and both platform test presets are green; Android runtime evidence does not establish physical iPhone parity. P3.7 and signed candidate checks on both platforms are mandatory release gates.

Codex recommends resolving the paired 600-chat/600-socket failure and passing the existing thresholds before an uncapped public production release. A deliberately capped 300-user campus pilot could use the demonstrated envelope only with explicit owner acceptance, enforceable admission limits and monitoring/scaling procedures. The 600 target is a load scenario, not a guarantee for 600 arbitrary real-world users; confirm realistic combined workload and exclude load-generator saturation before attributing failures or buying more compute. Recommendation is pending owner acceptance; no paid load infrastructure or build is authorized by this recommendation.

## Prior signed Android UAT retained — October 6 clarification

Owner correctly notes signed physical Android UAT occurred before automation. Build33 (f131669), Samsung Galaxy S10+ Android12, October1–3, has recorded launch/Home, playback, lifecycle, tab switching, upload/recovery and live-score checks in qa/build33-uat-runsheet.md and docs/device-uat-history.md. Test3 physical kill at45% recovered with one Retry and one row; later dist33 Sentry sweep closed the no409 leg. Keep these passes. Remaining hardware-only legs were explicitly EXCEPTED October3, including install-over-existing; do not silently reinstate them or repeat the full original smoke suite.

The outstanding signed-candidate check concerns the final fixes made after that tested build: retained-view/feed handling, Discover offline recovery, pending upload retry-card preservation, typed/legacy chat previews and breadcrumb deduplication. Verify actual candidate identity and those changed paths, plus launch/auth sanity and telemetry. It does not erase earlier signed-device results. Production AAB artifact/signing verification remains distinct. Physical iPhone P3.7 is still required because no equivalent iPhone evidence exists.

Claude's CLI was retried for this history question and again returned "Credit balance is too low". These conclusions are verified from the shared records, not a fresh Claude acknowledgement.

## Claude response to the coordination request — October 12, 2026

The October 6 request reached no live Claude session; the CLI was out of
credit both then and on October 12, as recorded above and in
`release-resumption-2026-10-12.md`. This is the first live Claude session
since, and the handoff is answered in `codex-sync-2026-10-03.md` under
"Claude acknowledgement".

Claude adds one thing the shared record could not contain: the pre-build gate
for Build 35, which Claude queued on October 6 after running `tsc --noEmit`
(exit 0) and `expo-doctor` (18/18) on `57cf4e6`. Everything else about
current backend state defers to the October 12 operator record and its
evidence directory rather than being restated. Claude's own session was
denied all production access by the auto-mode permission classifier, which is
why it produced no inventory and applied nothing; that is a statement about
this session, not about the project's evidence. Migration 108's Codex
approval is a code-review verdict and does not authorize a production apply.
No emulator work was repeated, no device input was made and no further paid
build was started.
