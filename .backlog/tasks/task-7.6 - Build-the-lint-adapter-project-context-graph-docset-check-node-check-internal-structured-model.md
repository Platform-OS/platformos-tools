---
id: TASK-7.6
title: >-
  Build the lint adapter: project context (graph + docset) + check-node check()
  -> internal structured model
status: To Do
assignee: []
created_date: '2026-06-08 10:01'
updated_date: '2026-06-12 13:17'
labels: []
dependencies:
  - TASK-7.2
  - TASK-7.3
  - TASK-7.4
references:
  - packages/platformos-graph
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.ts
  - packages/platformos-check-common/src/find-root.ts
  - packages/platformos-check-node
parent_task_id: TASK-7
priority: high
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
## Partial progress — lint-only slice (2026-06-12)

Implemented the MINIMAL lint adapter so `validate_code` lints for real (user-directed: only the check() adapter now).

### Done
- `src/lint/lint.ts`: `runLint({ projectDir, filePath, content }) -> ValidateCodeDiagnostic[]` — resolves the absolute file path, calls the check-node `lintBuffer` seam (TASK-7.3: `check()` with the buffer overlaid on the on-disk project; NO LSP), and maps `Offense[]` → diagnostics (severity enum→string; 0-based line+char → 1-based line+column).
- `src/lint/lint.spec.ts` (3, hermetic temp project, docset/network-free): real offense → mapped diagnostic with 1-based range; clean file → []; absolute path accepted.
- This is the ONLY I/O boundary on the request path; the architecture guard (no language-server import on the lint path) passes over `src/lint`.

### NOT yet done (full 7.6 scope)
- A dedicated `lint/project-context.ts` `ProjectContext` built EXPLICITLY from `platformos-graph` + `AugmentedPlatformOSDocset` with a TTL cache and root via check-common `findRoot`. The current slice relies on `lintBuffer`'s internal app/docset construction (per call) and uses `ctx.projectDir` directly as root.
- `lint/model.ts` `StructuredDiagnostic` carrying structured `fix`/`suggest` + matched identifiers for the enrich stage. The current slice maps `Offense` straight to the agent `ValidateCodeDiagnostic` (no enrich layer yet), so fixes/identifiers are not carried.

When enrich (7.7) lands, insert StructuredDiagnostic between lint and the result mapping.
<!-- SECTION:NOTES:END -->
