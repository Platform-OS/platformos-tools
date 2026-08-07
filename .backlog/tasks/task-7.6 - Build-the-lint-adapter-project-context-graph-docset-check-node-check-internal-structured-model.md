---
id: TASK-7.6
title: >-
  Build the lint adapter: project context (graph + docset) + check-node check()
  -> internal structured model
status: To Do
assignee: []
created_date: '2026-06-08 10:01'
updated_date: '2026-08-07 14:48'
labels: []
dependencies: []
references:
  - packages/platformos-graph
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.ts
  - packages/platformos-check-common/src/find-root.ts
  - packages/platformos-check-node
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-7
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement `lint/`: assemble a `ProjectContext` (cross-file graph via `platformos-graph`, docset via `AugmentedPlatformOSDocset` fed by `platformos-check-docs-updater`), lint the buffer via the check-node structured API (task-7.3), and map `Offense[]` -> the internal `StructuredDiagnostic` model that downstream pure stages consume.

## Why
This is the ONLY I/O boundary on the request path. It replaces the old in-process LSP + project-scanner + project-fact-graph + FiltersIndex/ObjectsIndex/TagsIndex with shared, canonical building blocks.

## Reused primitives (do NOT re-implement)
The supervisor is a leaf consumer. Use the engine's existing primitives instead of re-deriving them:
- Project root resolution: `find-root` from `platformos-check-common` (`packages/platformos-check-common/src/find-root.ts`). Do NOT write a bespoke root finder.
- Filesystem + document location: the check-node `AbstractFileSystem` / `DocumentsLocator` wiring used by `check()` (task-7.3). The in-memory buffer overlay rides on this, not on a custom scanner.
- Cross-file graph: `platformos-graph` ONLY.
- Docset: `AugmentedPlatformOSDocset` ONLY (memoization, alias expansion, undocumented-entry injection live there).

FORBIDDEN in this package (these were the old duplications): a re-implemented `project-scanner`, `project-fact-graph`, `dependency-graph`, or bespoke `FiltersIndex`/`ObjectsIndex`/`TagsIndex` docset wrappers.

## Scope
- `lint/project-context.ts`: build/refresh (TTL cache ok) the graph + docset for a project dir; resolve the root via `find-root`.
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
- [ ] #4 Project root is resolved via check-common find-root; the package contains no bespoke root finder
- [ ] #5 Filesystem/document access goes through the check-node AbstractFileSystem/DocumentsLocator used by check(); the buffer overlay rides on it, not on a custom scanner
- [ ] #6 A test/guard asserts the package does not re-implement project-scanner, project-fact-graph, dependency-graph, or FiltersIndex/ObjectsIndex/TagsIndex docset wrappers
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — five of six ACs look met; AC #2 is the whole remaining gap

`src/lint/lint-batch.ts` + `src/context.ts` + `src/graph-cache/` exist and the package
lints through check-node with a graph-backed project context, so ACs #1, #3, #4, #5 and
#6 appear satisfied by inspection.

**AC #2 is not met, and it is the substantive one.** It requires `Offense` to map to a
structured diagnostic "with fix/suggest and matched identifiers carried as data".
`toDiagnostic` (`lint/lint-batch.ts:166`) sets exactly seven fields — `check`, `severity`,
`message`, `line`, `column`, `end_line`, `end_column` — and drops `Offense.fix` and
`Offense.suggest` entirely. There is no `StructuredDiagnostic` intermediate model; offenses
map straight to the agent-facing `ValidateCodeDiagnostic`.

Whether that intermediate model is still wanted is worth deciding rather than assuming:
the agent-facing type already declares `hint`, `suggestion`, `confidence`, `fix` and
`see_also`, so a second internal shape may be redundant.

**"Matched identifiers carried as data" depends on TASK-8.1**, which is genuinely
untouched — `Offense` today is `{ type, check, message, uri, severity, start, end, fix?,
suggest? }` with no typed payload field.

Note the file this task's ACs describe as `lint/lint.ts` is now `lint/lint-batch.ts`.

**Overlaps TASK-8.6 and TASK-7.7** on the fix/suggest passthrough — see TASK-8.6's note.
<!-- SECTION:NOTES:END -->
