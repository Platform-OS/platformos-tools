---
id: TASK-7.3
title: >-
  Provide a structured batch lint API in check-node (Offense[] with fix/suggest
  + cross-file project context)
status: To Do
assignee: []
created_date: '2026-06-08 10:00'
labels: []
dependencies: []
references:
  - packages/platformos-check-node
  - packages/platformos-check-common/src/index.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Give the new supervisor a single, documented Node entrypoint that lints a buffer in the context of its project and returns check-common STRUCTURED `Offense[]` — structured `fix`/`suggest` and matched identifiers intact — without any LSP/JSON-RPC.

## Why
This is the typed seam between the engine and the supervisor. check-node already exposes `check(root)`; we need to confirm/extend it for the validate_code use case (one file under edit + the rest of the project on disk for cross-file checks like MissingPartial/MissingPage/OrphanedPartial) and guarantee no structure is lost in the node wrapper.

## Scope
- Audit `platformos-check-node` `check()`; confirm Offense carries structured fix/suggest end to end.
- Add (if missing) a "lint one buffer with project overlay" variant: the in-memory file under edit overlays the on-disk project so cross-file checks see unsaved content.
- Document the entrypoint in check-node README + CLAUDE.md.

## Out of scope
- Supervisor wiring (task-7.6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A documented check-node entrypoint returns Offense[] for a buffer + project root with structured fix/suggest preserved
- [ ] #2 Cross-file checks resolve using on-disk project context, with the edited buffer overlaid in memory
- [ ] #3 A check-node unit test pins the structured shape (fix/suggest present, check code, range)
<!-- AC:END -->
