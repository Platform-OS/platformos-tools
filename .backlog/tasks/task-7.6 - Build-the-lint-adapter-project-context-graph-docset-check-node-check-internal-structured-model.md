---
id: TASK-7.6
title: >-
  Build the lint adapter: project context (graph + docset) + check-node check()
  -> internal structured model
status: To Do
assignee: []
created_date: '2026-06-08 10:01'
labels: []
dependencies:
  - TASK-7.2
  - TASK-7.3
  - TASK-7.4
references:
  - packages/platformos-graph
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement `lint/`: assemble a `ProjectContext` (cross-file graph via `platformos-graph`, docset via `AugmentedPlatformOSDocset` fed by `platformos-check-docs-updater`), lint the buffer via the check-node structured API (task-7.3), and map `Offense[]` -> the internal `StructuredDiagnostic` model that downstream pure stages consume.

## Why
This is the ONLY I/O boundary on the request path. It replaces the old in-process LSP + project-scanner + project-fact-graph + FiltersIndex/ObjectsIndex/TagsIndex with shared, canonical building blocks.

## Scope
- `lint/project-context.ts`: build/refresh (TTL cache ok) the graph + docset for a project dir.
- `lint/lint.ts`: call check-node check() with the buffer overlay; receive Offense[].
- `lint/model.ts`: `StructuredDiagnostic` carrying check code, range, severity, the matched identifier(s), and the structured fix/suggest — NO message-string parsing.

## Out of scope
- Enrichment/hints (task-7.7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ProjectContext is built from platformos-graph + AugmentedPlatformOSDocset (no bespoke graph or docset wrapper)
- [ ] #2 Linting goes through the check-node structured API; Offense maps to StructuredDiagnostic with fix/suggest and matched identifiers carried as typed fields
- [ ] #3 No message-string regex parsing anywhere in lint/ (task-7.1 guard passes)
<!-- AC:END -->
