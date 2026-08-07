---
id: TASK-7.10
title: Wire the validate_code handler end-to-end with full/quick modes
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-08-07 14:47'
labels: []
dependencies:
  - TASK-7.9
parent_task_id: TASK-7
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Replace the stub handler (task-7.4) with the real composition: lint/ -> enrich/ -> advise/ -> result/. Implement `full` and `quick` modes (quick skips the heavier ergonomic stages).

## Scope
- Compose the stages behind validate_code; thread ProjectContext (cached) through.
- Define mode behaviour explicitly and document it.
- Map internal errors to a typed tool error/status.
- Update README + ARCHITECTURE.md with the final request flow.

## Out of scope
- New tools beyond validate_code (additive later).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 validate_code runs the real lint -> enrich -> advise -> result composition and returns a typed ValidateCodeResult
- [ ] #2 full and quick modes behave as documented
- [ ] #3 README and ARCHITECTURE.md describe the final request flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — AC #2 is dead; AC #1 is blocked, not done

**AC #2 ("full and quick modes behave as documented") can never be satisfied — `mode`
was deliberately REMOVED.** TASK-12.5 (archived, Done) decided against it: the parameter
was advertised in the schema and did nothing, both branches returning the same result at
the same cost, and giving it real semantics was rejected because "there is no longer a
heavy stage worth skipping" — a warm call is ~340 ms of which the buffer's own work is
~84 ms, the rest being fixed project cost a `quick` mode could not skip without making
the answer wrong. `ValidateCodeParams` today is `{ file_path?, content?, files? }`.
**Strike AC #2** rather than implement it.

**AC #1 is genuinely outstanding, but blocked upstream.** `validate_code` IS registered
(`transport/validate-code.ts:175`) and returns a typed `ValidateCodeResult` end to end,
so the handler is no longer a stub. What is missing is two of the four stages it names:
`src/enrich/` and `src/advise/` do not exist (TASK-7.7, TASK-7.8). The real composition
today is lint → result.

So this is not "wire it up" work any more; it is "add the two missing stages, then
compose". Consider reducing it to that, or folding it into 7.7/7.8's completion.
<!-- SECTION:NOTES:END -->
