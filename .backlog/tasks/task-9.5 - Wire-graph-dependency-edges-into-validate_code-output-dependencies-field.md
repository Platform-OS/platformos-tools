---
id: TASK-9.5
title: Wire graph dependency edges into validate_code output (dependencies field)
status: Done
assignee: []
created_date: '2026-06-29 14:38'
updated_date: '2026-07-03 07:38'
labels: []
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-mcp-supervisor/src/lint/lint.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - >-
    packages/platformos-mcp-supervisor/test/guards/architecture-invariants.spec.ts
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
The whole point of extending platformos-graph (TASK-9) is to enrich the supervisor's `validate_code` with structural info. The graph already exposes the per-file primitive `extractFileReferences(rootUri, sourceUri, sourceCode, { fs })` → `Reference[]` (TASK-9.3; layout edges added in TASK-9.4). Today the supervisor declares `@platformos/platformos-graph` as a dep but never consumes it: `validate_code` is still lint-only.

This task wires it in: `validate_code` output gains a `dependencies` array (what the file renders/includes/runs/queries/wraps, with canonical resolved target + kind + location). This is TASK-9 AC#5 (supervisor consumes the API, contains NO graph logic of its own).

## Design (respect package responsibilities + the architecture guards)
- NEW I/O adapter `src/structure/structure.ts` (a sibling to `src/lint/lint.ts`, the other I/O boundary): parses the in-flight BUFFER via `toSourceCode`, calls `extractFileReferences` with `NodeFileSystem` rooted at projectDir, maps `Reference[]` → agent-facing `ValidateCodeDependency[]`. No whole-graph build; works for not-yet-on-disk buffers.
- REUSE check-common for the mapping math — do NOT reimplement: `path.relative(target.uri, rootUri)` for the project-relative target; `getPosition(content, offset)` for offset→line/col (the same util check() uses; add its one-line public export). Reuse `NodeFileSystem` (check-node) and `toSourceCode`/`extractFileReferences` (graph).
- `result/` stays PURE: a new `dependencies` param on `assembleResult` is included verbatim. No I/O, no graph logic in result/.
- Agent surface: `ValidateCodeDependency { kind: string; target: string; line: number; column: number }` — `kind: string` mirrors the existing `check: string` precedent (no ReferenceKind duplication/coupling). 1-based line/col like the rest of the surface.
- Run structure alongside lint (`Promise.all`) in the handler.
- Guard: add `'structure'` to `LINT_PATH_LAYERS` so the no-LSP invariant covers the new layer; structure/ must NOT be a PURE layer (it does I/O, like lint/).

## Do NOT
- Re-flag missing targets as diagnostics (lint already emits MissingPartial). The graph value is the canonical resolved target + kind, not re-detection.
- Add graph/scanner logic to the supervisor. It only calls extractFileReferences + maps.
- Build a whole-project graph or compute incoming references (that needs caching; separate, TASK-9.2 territory).</description>
<parameter name="acceptanceCriteria">["validate_code result includes a `dependencies: ValidateCodeDependency[]` populated from platformos-graph's extractFileReferences (kind, project-relative target, 1-based line/col); empty for files with no static deps", "New src/structure/ I/O adapter is the only new code path; result/ stays pure (no fs/process/graph logic); architecture-invariants guard extended to cover structure/ for the no-LSP invariant and stays green", "Mapping reuses check-common (path.relative + getPosition) and graph (extractFileReferences/toSourceCode) + check-node NodeFileSystem — no reimplementation of path/position/graph logic in the supervisor", "TDD: unit pins for the structure adapter (render/function/graphql/include/background/asset/layout, module-prefixed, no-deps, non-liquid) + updated assemble + stdio-smoke whole-value assertions", "Verification: supervisor tests pass; type-check + format clean; additive (existing validate_code behavior unchanged besides the new field)"]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 validate_code result includes a `dependencies: ValidateCodeDependency[]` populated from platformos-graph's extractFileReferences (kind, project-relative target, 1-based line/col); empty for files with no static deps
- [x] #2 New src/structure/ I/O adapter is the only new code path; result/ stays pure (no fs/process/graph logic); architecture-invariants guard extended to cover structure/ for no-LSP and stays green
- [x] #3 Mapping reuses check-common (path.relative + getPosition) + graph (extractFileReferences/toSourceCode) + check-node NodeFileSystem — no reimplementation in the supervisor
- [x] #4 TDD: unit pins for the structure adapter (all edge kinds, module-prefixed, no-deps, non-liquid) + updated assemble + stdio-smoke whole-value assertions
- [x] #5 Verification: supervisor tests pass; type-check + format clean; additive (existing validate_code behavior unchanged besides the new field)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented (2026-06-29) — graph dependencies wired into validate_code

Branch `supervisor-graph-integration` (graph repo). TDD, additive, responsibilities kept separate.

### New / changed
- **`src/structure/structure.ts`** (NEW I/O adapter, sibling to `lint/`): `runStructure({projectDir,filePath,content})` → parses the in-flight BUFFER via graph `toSourceCode`, calls graph `extractFileReferences` with check-node `NodeFileSystem`, maps `Reference[]` → `ValidateCodeDependency[]`. REUSES check-common `path.relative` (uri→project-relative) + `getPosition` (offset→1-based line/col) + re-exported `path.URI`; reuses graph + check-node. No graph/path/position logic reimplemented.
- **`src/result/types.ts`**: added `ValidateCodeDependency { kind:string; target:string; line:number; column:number }` (`kind:string` mirrors `ValidateCodeDiagnostic.check`, decoupled from upstream ReferenceKind) + required `dependencies: ValidateCodeDependency[]` on `ValidateCodeResult` (always present, empty when none).
- **`src/result/assemble.ts`**: new `dependencies` data param, included verbatim. result/ stays PURE (guard-enforced).
- **`src/transport/validate-code.ts`**: runs `runLint` + `runStructure` concurrently (`Promise.all`), passes both to `assembleResult`.
- **check-common `src/index.ts`**: one-line public re-export of `getPosition` (the canonical offset→position util `check()` itself uses) so the supervisor reuses it instead of re-counting newlines.
- **guard `test/guards/architecture-invariants.spec.ts`**: added `'structure'` to `LINT_PATH_LAYERS` (no-LSP invariant now covers the new layer). structure/ is NOT a PURE layer (it does I/O, like lint/).

### Tests (comprehensive — final agent-facing output is pinned)
- `structure.spec.ts` (14): every edge kind (render/include/function/background/graphql/asset/layout), module-prefixed, multi-line position, source-order multi-dep, no-deps, dynamic-skip, non-Liquid → [], relative+absolute paths.
- `assemble.spec.ts`: envelope + verbatim dependency pass-through (status unaffected).
- **`stdio-smoke.spec.ts` (END-TO-END via the real MCP bin over stdio)**: exact whole-result assertions incl. `dependencies` — page→partial, layout+function+render in source order, and the critical **lint-error AND dependencies together** case (proves they coexist without conflation), plus dynamic-target = no invented deps. This is the anti-mislead guarantee for coding agents.

### Verification
- supervisor: **50 pass** (incl. 7 stdio integration). type-check clean; `yarn format:check` clean. Additive — existing validate_code behavior unchanged besides the new field.
- Refreshed stale `platformos-check-node` dist (pre-existing: dist lacked `lintBuffer` though src had it) so the supervisor src-path type-check is clean too.

This fulfills TASK-9 AC#5: the supervisor consumes the graph API and contains NO graph/scanner logic of its own.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed as specified: `validate_code` gained a `dependencies` field populated from platformos-graph `extractFileReferences` via a new pure `src/structure/` I/O adapter (reusing check-common path.relative + getPosition, graph toSourceCode/extractFileReferences, check-node NodeFileSystem — no graph logic in the supervisor), architecture guard extended, TDD incl. end-to-end stdio-smoke. This fulfilled TASK-9 AC#5.

SUPERSEDED by TASK-9.10: the per-file `dependencies`/`structural` fields were subsequently REMOVED and replaced by cross-file `impact` (blast radius), because lint already covers the forward/per-file view (MissingPartial/PartialCallArguments) — the graph's unique value is the backward/cross-file view. `src/structure/` was deleted in that refactor. So this task's deliverable shipped and then was intentionally replaced; closing as Done for the record (the work was executed to completion), with the supersession noted. See SUPERVISOR-GRAPH-INTEGRATION.md §1/§9.
<!-- SECTION:FINAL_SUMMARY:END -->
