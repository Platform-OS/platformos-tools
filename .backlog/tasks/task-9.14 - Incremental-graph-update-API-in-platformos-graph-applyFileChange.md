---
id: TASK-9.14
title: Incremental graph update API in platformos-graph (applyFileChange)
status: Done
assignee:
  - Filip
created_date: '2026-07-02 06:45'
updated_date: '2026-07-02 08:49'
labels:
  - platformos-graph
  - performance
  - architecture
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/graph/query.ts
modified_files:
  - packages/platformos-graph/src/graph/incremental.ts
  - packages/platformos-graph/src/graph/incremental.spec.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/index.ts
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The graph cache currently does a FULL rebuild (~22s on a 1,500-node project) on ANY change, so blast-radius goes `computing` for ~22s after every file write. The graph is "embarrassingly incremental": a file's OUTGOING edges depend ONLY on that file's own content (parse it → its render/include/function/graphql/asset/layout edges; no cross-file type inference). So a change can be applied in O(edges of the changed file), not O(project). This is the enabler for an always-fresh, always-instant graph.

WHAT. A pure incremental-update API in platformos-graph (structure logic lives here per ADR 003), consumed by the supervisor cache (TASK-9.14):

`applyFileChange(graph, uri, kind: 'modified' | 'added' | 'deleted', deps): Promise<void>` (or a functional variant returning a new graph), that mutates/derives the graph WITHOUT a full rebuild:
- MODIFIED: re-parse only `uri` (reuse `resolveLiquidReferences`), diff its outgoing edges, and patch the reverse index — remove the file's OLD `F→*` edges from each old target's `references`, add the new ones; replace the module's `dependencies`.
- ADDED: create/flip the node to `exists: true`, resolve + add its own outgoing edges. Incoming edges that already point at this URI resolve automatically (edges are keyed by canonical target URI; `exists` is a node property) — no rewiring needed.
- DELETED: set the node `exists: false`, remove its OUTGOING edges from targets' `references`; incoming edges become "missing" automatically.

This mirrors what `extractFileReferences` already does per file, plus reverse-index maintenance. Reuse `resolveLiquidReferences` / the module factories; do not fork resolution.

CORRECTNESS (load-bearing — a wrong incremental result misleads the agent, which is the cardinal sin): the result of a sequence of `applyFileChange`s MUST equal a from-scratch `buildAppGraph`. This is the core invariant to test exhaustively. Consumers keep a fingerprint authority + full-rebuild fallback (TASK-9.14), but the API itself must be provably correct.

PROVEN PRECEDENT (we apply, not invent): rust-analyzer/Salsa (demand-driven incremental), LSP didChangeWatchedFiles, TypeScript --incremental, module-bundler HMR graphs. Ours is simpler (per-file syntactic edges) so a hand-rolled apply suffices — no Salsa framework needed.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `applyFileChange(graph, uri, kind, deps)` exists in platformos-graph and updates the in-memory graph for modified/added/deleted WITHOUT a full rebuild, reusing resolveLiquidReferences + the module factories (no forked resolution).
- [x] #2 MODIFIED re-parses only the changed file, diffs its outgoing edges, and correctly patches the reverse index (targets' `references`) — added/removed edges reflected, unchanged ones preserved.
- [x] #3 ADDED flips the node to exists:true and its own edges are added; incoming edges that referenced the now-existing URI resolve (exists) without rewiring.
- [x] #4 DELETED sets exists:false and removes the file's outgoing edges from targets; incoming edges become missing.
- [x] #5 CORE INVARIANT (exhaustively tested): applying any sequence of changes yields a graph deep-equal to a from-scratch buildAppGraph of the same final disk state (add, modify, delete, add-then-reference, delete-referenced, rename=delete+add, cyclic edges, self-reference).
- [x] #6 Complexity is O(edges of the changed file), not O(project) — verified (no whole-project re-parse in applyFileChange).
- [x] #7 TDD: unit tests per change kind + the equivalence-to-full-build property; graph suite + type-check + format green; no regression to buildAppGraph/query API.
- [x] #8 Exported from the package index; documented (incl. the exists-flip elegance and the equivalence invariant).
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
REFINED ALGORITHM (after reading traverse/augment/module/query internals).

EDGE STORAGE: bind() creates ONE Reference object pushed to BOTH source.dependencies and target.references (shared instance). Removing F's edges from a target T = T.references.filter(r => r.source.uri !== F.uri). Module nodes are deduped in a per-graph ModuleCache (WeakMap); graph.modules[uri] === the cached object; factories return that same object (existing) or a fresh one (new).

FRESH READ: augmentDependencies MEMOIZES getSourceCode, so applyFileChange must augment FRESH per call (like buildAppGraph) to re-read the changed file. It takes raw IDependencies and augments internally.

MODIFY = removeFile + addFile (DRY, and provably equivalent).
- removeFile(graph, uri): node=graph.modules[uri]; drop node's outgoing edges from each target's references; GC each target that is now unreachable (`!isEntryPoint(graph,target) && target.references.length===0` — i.e. a reached-only leaf like graphql/asset that a full build would omit; liquid files are entry points so never GC'd, and leaves have no outgoing edges so no cascade); clear node.dependencies; remove uri from graph.entryPoints; then if node.references is empty delete graph.modules[uri] entirely, else set node.exists=false (a still-referenced missing target).
- addFile(graph, uri, deps, options): node = graph.modules[uri] ?? getModule(graph,uri) (undefined → not a graph-classifiable file → no-op); set node.exists via exists(fs,uri); add to graph.modules; add to graph.entryPoints if a liquid entry-point kind and absent; resolveLiquidReferences(fresh read) → for each ref: materializeTarget (if target absent: add to modules + set exists + set table for graphql leaves) then bind(node,target,{range,kind,args}). Incoming edges to a previously-missing F resolve automatically once node.exists flips true (edges key on target.uri; exists is a node property).

PRECONDITION (documented + asserted by the equivalence test's build mode): the graph is fully materialized — built with all source files as entry points (the supervisor cache's mode). Then every liquid target is already a node; only leaf targets (graphql/asset) are materialized on demand / GC'd, so no traversal recursion is needed.

EQUIVALENCE INVARIANT (AC#5): serializeAppGraph(incremental) deep-equals serializeAppGraph(buildAppGraph(finalDisk, allLiquidEntryPoints)) with nodes+edges sorted. serialize covers nodes{uri,type,kind,exists}+edges{Reference} — the correctness surface. entryPoints is not serialized but is maintained anyway for future query consumers.

REUSE: export resolveLiquidReferences (+ ResolvedReference) from traverse.ts; reuse bind, getModule, exists, extractGraphqlTable, augmentDependencies, isEntryPoint. New file src/graph/incremental.ts holds applyFileChange + removeFile/addFile/materializeTarget. Export applyFileChange from the package index.

TESTS (TDD, property-based invariant as guardrail): a temp project (node fs) built all-liquid; enumerate scenarios — modify(add edge to existing/new graphql/asset/partial), modify(remove last edge → GC), modify(remove one of several), add(new file, and file with pre-existing incoming placeholder → exists-flip preserves refs), delete(referenced → exists:false kept; unreferenced → node removed), rename=delete+add, self-reference, cycle A↔B; after each, assert serialize(incremental)==serialize(fresh buildAppGraph). Plus targeted unit assertions on dependentsOf after each kind.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `applyFileChange(graph, uri, kind, deps, options?)` to platformos-graph (new src/graph/incremental.ts; exported from the package index alongside the `FileChangeKind` type) — an in-place incremental graph update that avoids a full rebuild on every file change (the ~22s-per-write bottleneck behind blast-radius going `computing`). Complexity is O(edges of the changed file).

Reuses the exact build seams (resolveLiquidReferences — now exported from traverse.ts — plus bind, getModule, isEntryPoint, augmentDependencies, extractGraphqlTable/extractSchemaTable), so resolution can never drift from buildAppGraph. modify = removeFile + addFile: removeFile detaches the file's outgoing edges from each target's reverse index, garbage-collects any target that becomes an unreachable non-entry-point reached-only leaf, drops the file from entryPoints, and removes the node unless still referenced (kept exists:false); addFile materializes/refreshes the node, registers edge-source liquid files as entry points, and resolves+binds outgoing edges (materializing newly-reached leaves with their table fact). Incoming edges to an added/deleted file resolve automatically via the exists flag — no rewiring. Dependencies are augmented fresh per call so the changed file is re-read (the default getSourceCode memoizes), guaranteeing never-stale results.

Load-bearing guardrail (incremental.spec.ts, 12 tests): expectEquivalentToFullBuild mutates a real temp project on disk, applies the change, and asserts serializeAppGraph(incremental) canonically equals a fresh buildAppGraph over all edge-source liquid entry points — across MODIFIED (add edge / GC leaf / orphan-partial-kept / newly-reached leaf table), ADDED (new entry point / missing-target exists-flip), DELETED (referenced→missing kept / unreferenced→removed + leaf GC), self-reference, cycle, mixed sequence, and unmodeled-file no-op.

Verification: full graph suite 96/96 green; tsc --noEmit clean; prettier clean; yarn build:ts emits incremental.{js,d.ts,js.map}. Consumer wiring (GraphCache warm/incremental apply + persistence + fs.watch) is TASK-9.15.
<!-- SECTION:FINAL_SUMMARY:END -->
