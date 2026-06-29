---
id: TASK-7.9
title: >-
  Build result assembly: order-independent transforms -> ValidateCodeResult
  (cluster, scorecard, status, next_step)
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-06-12 13:17'
labels: []
dependencies:
  - TASK-7.7
  - TASK-7.8
parent_task_id: TASK-7
priority: medium
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
## Partial progress — lint-only slice (2026-06-12)

Implemented a MINIMAL slice of result assembly to support the lint-only `validate_code`.

### Done
- `src/result/assemble.ts`: PURE `assembleResult(diagnostics, mode) -> ValidateCodeResult`. Buckets diagnostics by severity into errors/warnings/infos; derives `status` (error>warning>ok) and `must_fix_before_write` (minimal rule: any error blocks). Imports ONLY `./types` — no engine, no I/O — so the task-7.1 purity guard is trivially satisfied.
- `src/result/assemble.spec.ts` (5): severity bucketing, status derivation, must_fix, ok-on-empty/infos-only, and asserts the deferred fields stay empty/null.

### NOT yet done (full 7.9 scope)
- Clustering, architecture scorecard, the EXPLICIT blocking-warning set (current must_fix = has-errors only), `next_step` prose, and tips/domain_guide/structural (TASK-8).
- Note on ordering: the 0-based→1-based line/column normalization currently lives in the `lint/` Offense→diagnostic mapping (since there is no enrich layer yet), not in `result/`. Revisit when the enriched-diagnostic input lands.
<!-- SECTION:NOTES:END -->
