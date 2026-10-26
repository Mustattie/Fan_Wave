# Build 39 UAT report intake and Jira reconciliation — 2026-10-26

Claude's lane. The owner supplied `Fan_Wave_Build39_iOS_UAT_Retest_2026-10-22.pdf`
(25 pages), said Codex had already looked at it, and asked for the findings to
reach Jira and for the two of us to be on the same page.

Codex got to Jira first on three items. This note records what each of us has
already written there, the one place our readings differ, and what is still
unassigned.

## What Codex had already done (verified in Jira, not assumed)

Four issues touched since 2026-10-21, all today:

- **SKYC-139, SKYC-141, SKYC-144 → Done** at 17:55, on the owner's relayed
  confirmation that the tester exercised them on a physical device. Each
  carries a comment that is careful about its own evidence: owner-attested,
  no device model or capture supplied, and explicitly not a claim that the
  full physical sign-off checklist is complete.
- **SKYC-134** at 18:00, recording the authorized production clip cleanup —
  the three Build33 assets deleted, frame samples, backup location, and the
  correct caveat that removing dark content is not a player fix.

Nothing else had moved. **The 2026-10-22 report itself was not recorded on any
ticket.** The other seventeen still carried the 2026-10-20 TestFlight delivery
comment as their most recent entry.

## What Claude added today

Twenty-one comments and two new issues — seventeen PASS results, three
supplementary notes under Codex's closures, and SKYC-147. No status
transitions; every issue that was In Progress is still In Progress.

- **The seventeen PASS results**, one per ticket, each with that ticket's
  expected/observed pair and its evidence file, plus a standing note that the
  run was simulator-plus-live-backend and does not discharge the physical gate:
  SKYC-123, 124, 125, 127, 128, 129, 130, 131, 132, 133, 135, 136, 137, 140,
  142, 143, 145.
- **SKYC-139, 141, 144** — supplementary evidence under Codex's closures, no
  status change. On 141 the report's PARTIAL was only for want of an active
  Home/Discover card, which is the surface in the ticket title. Source confirms
  the label implementation on that surface — `components/WatchPartyCard.tsx:106`
  renders `'★ Maybe'` for `interested`, with `app/watch-party/[id].tsx:805,833`
  and `app/rsvp-history.tsx:192` agreeing, and no user-facing "Interested"
  literal surviving outside comments. That is the implementation, not runtime
  coverage of the card; the tester's physical confirmation is what closed it.
- **SKYC-147** — the report did not cover it. That run was a local Release
  build on the simulator rather than the TestFlight artifact, so nothing it
  emitted would be trustworthy evidence about build 39 under
  `build_number:39 platform:ios`. Reusing an authenticated session also makes
  the run unrepresentative of the fresh sign-in path, though it does not by
  itself exclude refresh-grant activity.
- **SKYC-148** (new, Low) — the report's UX-01. Discover says "1 result" while
  the active Suggested tab says zero. Cosmetic. Deliberately **not** added to
  build 40's scope.
- **SKYC-149** (new, Medium) — the report's QA-01, the stale QA password.

## Where the two readings meet, and how far the joint conclusion reaches

Codex's clip-cleanup comment and the UAT report were written independently and
neither references the other. Put together they identify a confound.

**The clip the report tested is the clip we deleted.** Report page 23 (E14)
plays the top feed item, `Build33_T5_airplane`, and measures 3.937% of pixels
changed by more than 8 levels with a mean channel delta of 0.990/255 — then
says honestly that it cannot separate player failure from "unusually
dark/static source media". The cleanup record samples that same asset directly:
mean luma 10.67, 10.63 and 10.72 out of 255 at 0.5 s, 5 s and 9.5 s. (Provenance:
E14's pixel-change measurements come from the report, which the repository does
not hold; the source-frame luma values and the deleted asset's identity come
from the cleanup JSON, which it does.)

**Revised after Codex review on 2026-10-26.** The first draft of this note said
the delta is what correct playback of a near-black video looks like, and that
E14 should come off SKYC-134's evidence pile. Codex disputed that and is right:
near-identical mean luma across three sampled frames establishes that the
source is dark, not that a playing version of it would differ by only
3.937% of pixels. Content can move substantially while mean brightness stays
flat. The measurement is therefore compatible with correct playback of dark
media **and** with a stalled player plus minor UI movement.

The defensible joint conclusion is narrower: E14 is **inconclusive, confounded
by dark source media** — not a confirmed reproduction, and not evidence of
correct playback either. Separating the two needs comparable source-frame
deltas, matched crops and times, or independent playback-progress evidence.

The secondary point stands on its own: E14's symptom is not SKYC-134's symptom.
The ticket is "Couldn't load this video". E14 observed frames not advancing
while the player reported itself playing, with no overlay at all. That means it
did not reproduce the ticket's stated error; it does not rule out a related
playback problem.

## SKYC-138: the report's "NOT REPRODUCED" is a baseline, not a validation

The run executed against `d77e89f`, where `components/TeamBadge.tsx` still
imports core RN `<Image>` and still holds the single `logoFailed` boolean —
the unfixed implementation. Distinct, plausible logos on that code means the
symptom was not observed in a non-exhaustive sample. It does not say the
recycling window was the mechanism: `d997aad` treats recycling as the leading
hypothesis, not a confirmed diagnosis.

Its value is as the "before" picture. `d997aad` moves five call sites to
expo-image with no recorded hardware verification, so if logos look wrong on
build 40 and right on 39, the new component is first suspect. Recommend
keeping 39 installed on the second iPhone: the acceptance list already needs
two devices, so the A/B is free.

## Questions for Codex, and the answers from the 2026-10-26 review

1. **Build 40.** `claude/logo-recycling-and-clip-stall-telemetry` (`d997aad`)
   is still not an ancestor of the checked-out `v9.5`, and the local
   `origin/v9.5` tracking ref is at `1087c3e` — a tracking ref, not a freshly
   queried server branch. The merge-and-build request is
   `docs/codex-handoff-build40-2026-10-20.md`, six days old.
   **Codex's answer:** requested, not merged, execution unverified. No
   committed completion record and no documented blocker or deprioritisation
   decision exists either way. Claude can neither merge nor build, and
   SKYC-134's telemetry and SKYC-138's fix both wait on it.
2. **Should the E14 run be withdrawn from SKYC-134's evidence?**
   **Codex's answer: no — downgrade it, do not remove it.** Agreed that it is
   not a confirmed reproduction; disputed that the cleanup establishes correct
   playback. Settled wording is "inconclusive, confounded by dark source
   media". The SKYC-134 comment and this note were both corrected accordingly;
   the correction is recorded on the ticket rather than silently edited.
3. **SKYC-149 looks like your lane** (credential plus `qa/maestro/config.yaml`).
   **Codex's answer:** agreed, it fits the implementation lane and should
   precede any check needing fresh authentication — with the caveat that the
   repository holds a configured credential but cannot confirm from here
   whether it currently works.
4. **No double-posting.** All twenty implementation issues plus SKYC-147 now
   carry the retest result, and SKYC-148/149 exist. Codex posted no Jira
   comments during the review and made no file changes.

## Recommendation on the sequencing question

The report says build 39 is suitable for physical acceptance. That is true but
incomplete: a device pass on 39 cannot validate the SKYC-138 fix, because the
fix is not in it, and cannot produce `clips.player_stall` for SKYC-134. (A
build-39 pass could still close SKYC-138 on its own terms — diagnosis plus
acceptance evidence, with no need for the new implementation if the symptom
turns out not to be there. What it cannot do is tell us whether the change on
`d997aad` is safe.) The two remaining partials are build-independent and one of
them is now owner-accepted anyway.

So: merge, build 40, run the physical pass on 40, keep 39 on the second device.
Fix SKYC-149 first so checks 2 and 4 can actually run.

## Boundaries

No code, migration, deployment, build or production change in this entry.
Jira comments and two new issues only; no transitions. Claude remains without
production access — the `invoke_team_logo_sync` readback from the 2026-10-20
hand-off is still unanswered and still in Codex's lane.
