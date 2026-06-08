---
id: TASK-7.10
title: Wire the validate_code handler end-to-end with full/quick modes
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
labels: []
dependencies:
  - TASK-7.9
parent_task_id: TASK-7
priority: high
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
