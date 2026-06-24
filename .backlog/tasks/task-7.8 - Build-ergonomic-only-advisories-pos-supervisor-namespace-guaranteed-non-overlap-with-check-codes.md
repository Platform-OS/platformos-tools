---
id: TASK-7.8
title: >-
  Build ergonomic-only advisories (pos-supervisor: namespace, guaranteed
  non-overlap with check codes)
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
labels: []
dependencies:
  - TASK-7.2
  - TASK-7.6
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement `advise/`: the subset of the old structural detectors classified as ERGONOMIC (not correctness) in task-7.2 — as a pure pass over the AST + ProjectContext emitting `pos-supervisor:*` advisories.

## Why
These are agent guidance, not lint correctness (which now lives in check-common). Because the correctness ones moved to the engine, advisories are guaranteed NOT to collide with check codes — the old dedup logic is unnecessary by construction.

## Scope
- Implement only the ergonomic detectors from the task-7.2 classification.
- Pure function over AST + context; `pos-supervisor:` namespace.
- A test asserting NO advisory code equals any check-common check code (collision guard).

## Out of scope
- Correctness detectors (task-7.2, in check-common).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ergonomic advisories emit under the pos-supervisor: namespace and are produced by a pure function
- [ ] #2 A test guarantees no advisory code collides with a check-common check code
- [ ] #3 No dedup-against-LSP logic exists (unnecessary by construction)
<!-- AC:END -->
