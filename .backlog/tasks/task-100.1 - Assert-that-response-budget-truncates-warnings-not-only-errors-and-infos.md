---
id: TASK-100.1
title: 'Assert that response-budget truncates warnings, not only errors and infos'
status: Done
assignee: []
created_date: '2026-09-03 06:30'
updated_date: '2026-09-03 07:37'
labels:
  - testing
  - platformos-mcp-supervisor
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/result/response-budget.ts
  - packages/platformos-mcp-supervisor/src/result/response-budget.spec.ts
parent_task_id: TASK-100
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`src/result/response-budget.ts` exists to stop one `validate_code` answer eating the agent's context — the module's own comment records an unbounded call measured at ~336,000 tokens. It slices three buckets when a result is over budget: `errors`, `warnings`, `infos`.

Only two of the three are asserted. MEASURED: replacing

    warnings: result.warnings.slice(0, taken.warnings),   // line ~158

with

    warnings: result.warnings,

leaves 289/289 tests passing across `src/result/` and `src/transport/`. The warnings truncation can be deleted and nothing notices.

This is the highest-risk gap of the set because warnings are the COMMON severity — a file with hundreds of them is exactly the tail this module defends against, and losing the slice reopens the unbounded response the budget was written for.

There is an existing test for the `errors` bucket; mirror it rather than inventing a new shape.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test drives a result whose `warnings` exceed the allocated budget and asserts the returned `warnings` array is sliced to exactly the allocated count
- [x] #2 The same test asserts the `truncated` field reports the true pre-truncation total for the warnings bucket, not the returned count
- [x] #3 Assertions use whole-value equality on the returned result per the repo's test guidelines — not a `length` check or a per-property read
- [x] #4 SABOTAGE-VERIFIED: replacing `result.warnings.slice(0, taken.warnings)` with `result.warnings` makes the new test fail; the change is reverted afterwards and the suite is green
- [x] #5 The existing errors and infos truncation tests still pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce the survivor first: replace `result.warnings.slice(0, taken.warnings)` with `result.warnings` and confirm the spec is still green (it was — 13/13).
2. Add a `bytesOf` helper to the spec that bills a diagnostic list the same way `costOf` does, and fold the existing `diagnosticBytes` onto it rather than duplicating the arithmetic.
3. Add one test that derives its budget from the entries (`bytesOf(warnings.slice(0, 12))`) so "twelve fit" is arithmetic, not a tuned constant, and asserts the whole returned shape in one equality.
4. Sabotage-verify, revert, then run the whole package suite, type-check and prettier.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Why the gap existed, which is worth recording because it is not obvious from the file: the errors slice IS pinned (by 'closes a bucket at the first entry that does not fit', which asserts the returned lines are exactly [1]) and the infos slice IS pinned (by 'spends the budget on errors before any info', which asserts infosReturned is exactly 0). Every warnings assertion in the file read a TOTAL or a PRESENCE — `truncated.warnings.total`, `truncated.warnings !== undefined` — and both of those survive returning the whole unsliced list. Confirmed by sabotage on all three slices, not inferred.

The budget is derived from the fixture (`bytesOf(warnings.slice(0, admitted))`) rather than hand-tuned. `diagnostic()` embeds the line number in the message, so entries on lines 1-9 and 10-40 differ in cost; a literal budget would be a magic number that quietly changes meaning if the fixture is touched. Paying exactly the cost of the first twelve makes the thirteenth fail `spent + cost > budgetBytes` by construction.

The generated `truncated.note` string is deliberately NOT asserted, per the repo's rule against pasting a message the code under test produces.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closes the highest-risk mutation survivor in the supervisor's response budget: the `warnings` bucket could be returned unsliced with the entire suite still green.

**What changed** — one test in `src/result/response-budget.spec.ts` drives a single file with 40 warnings against a budget that pays for exactly 12 of them, and asserts the whole returned result in one equality: the returned `warnings` array is `warnings.slice(0, 12)` element-for-element, `truncated.warnings` is `{ returned: 12, total: 40 }`, and the untouched buckets come back empty. A `bytesOf` helper now bills a diagnostic list the way `costOf` does; the pre-existing `diagnosticBytes` was folded onto it instead of keeping two copies of the same arithmetic.

**Why it matters** — warnings are the common severity, so a file with hundreds of them is exactly the tail the module was written for (its own comment records an unbounded call measured at ~336,000 tokens). Losing that slice reopens the unbounded response.

**Verification** — sabotage-verified both ways: with `warnings: result.warnings` substituted for the slice, exactly the new test fails and the other 13 pass; reverted, all 14 pass. Full package suite 542/542 green, `type-check` clean, prettier clean. No source file changed.
<!-- SECTION:FINAL_SUMMARY:END -->
