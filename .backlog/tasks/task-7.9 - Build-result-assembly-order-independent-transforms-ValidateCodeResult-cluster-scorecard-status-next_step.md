---
id: TASK-7.9
title: >-
  Build result assembly: order-independent transforms -> ValidateCodeResult
  (cluster, scorecard, status, next_step)
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-08-07 14:47'
labels: []
dependencies:
  - TASK-7.7
  - TASK-7.8
parent_task_id: TASK-7
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement `result/`: compose enriched diagnostics + advisories into the typed `ValidateCodeResult` via a set of ORDER-INDEPENDENT pure transforms. Explicitly NOT a load-bearing ordered pipeline.

## Scope
- Clustering (group repeated check-name diagnostics; unified-fix description).
- Architecture scorecard (advisory notes).
- Status derivation + `must_fix_before_write` boolean (define the blocking set explicitly).
- `next_step` prose; 0-based -> 1-based line normalization.
- Each transform is independent and individually unit-tested; document any ordering that genuinely remains and why.

## Out of scope
- The verify*/suppress*OnDisk false-positive corrections from the old pipeline — NOT needed: linting now runs with full project context, so those false positives do not arise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ValidateCodeResult is produced by independent pure transforms; any required ordering is documented with rationale
- [ ] #2 No verify*OnDisk / suppress* false-positive-correction steps exist
- [ ] #3 Clustering, scorecard, status, must_fix_before_write, and next_step each have unit pins
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — mostly built; AC #3 names two outputs that were removed

`src/result/` exists and does the job: `assemble.ts`, `blocking.ts`, `impact-states.ts`,
`response-budget.ts`, `types.ts`. ACs #1 and #2 look satisfied by inspection.

**AC #3 is half stale.** It requires unit pins for "Clustering, scorecard, status,
must_fix_before_write, and next_step". `status`, `must_fix_before_write` and `next_step`
are on `ValidateCodeResult` and pinned. **`clusters` and `scorecard` are not — they were
deliberately deleted.** TASK-12.5 (archived) removed six permanently-empty result stubs
in one commit — `proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`,
`parse_error` — because "an agent cannot distinguish an always-empty field from a
meaningful one". A clean-file result went from 15 keys to 6, and `assemble.spec.ts` now
pins the exact key set and asserts each removed field is ABSENT.

So clustering/scorecard cannot be re-added here without breaking that guard. TASK-12.5's
own note says they "return when TASK-8.x actually populates them" — which makes this
task's remaining scope dependent on TASK-8.2/8.3, not independent of them.
<!-- SECTION:NOTES:END -->
