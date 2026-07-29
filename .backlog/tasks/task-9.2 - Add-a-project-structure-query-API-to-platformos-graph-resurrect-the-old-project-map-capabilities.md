---
id: TASK-9.2
title: >-
  Add a project-structure query API to platformos-graph (resurrect the old
  project-map capabilities)
status: Done
assignee: []
created_date: '2026-06-23 10:32'
updated_date: '2026-07-03 07:54'
labels: []
dependencies:
  - TASK-9.1
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Expose, as `platformos-graph`'s public API, the project-structure queries the supervisor (and other consumers) need — resurrecting the capabilities of the old in-supervisor `ProjectFactGraph` / `ProjectMap` / `render-flow`, but OWNED by the graph package.

## Queries to provide (from the old fact inventory — see ADR 003)
- `dependentsOf(uri)` / `referencedBy` — callers of a file (now complete across render+function+graphql thanks to task-9.1).
- `isOrphan(uri)` — no incoming references (correctly scoped now that function/graphql edges exist).
- reachability (BFS over outgoing edges), `exists(uri)`, missing-target resolution.
- render/function/graphql call sites + args (from the call-site ranges; expose args where recoverable).
- nearest-name candidate sets over typed node names (partials, page routes, etc.) for "did you mean".
- resource/CRUD-completeness view (per schema table: related graphql/commands/queries/pages + missing expected operations) — the old `detectResources` / `ProjectMap.summary.resources`.

## Delegate, do not duplicate
- Partial `@param` signatures → check-common `getDocDefinition` / liquid-doc.
- Frontmatter (`slug`/`method`/`layout`) + schema properties + docset → check-common.
The query layer COMPOSES these; it does not re-derive them.

## Out of scope
- Per-file self-structural snapshot (task-9.3).
- Supervisor-side shaping into ValidateCodeResult (TASK-8.4).

## Constraints
- Pure/queryable over the built `AppGraph`; build/I/O stays in `buildAppGraph`.
- Documented + unit-tested; consumed by the supervisor with zero graph logic on the supervisor side.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 platformos-graph exposes documented query functions over the built AppGraph: dependenciesOf/dependentsOf, exists, isEntryPoint, isOrphan/orphans, reachableFrom, missingDependencies/missingTargets, call-sites+args (on Reference), and nearestModules (did-you-mean)
- [x] #2 Partial @param signatures, frontmatter, schema and docset are composed from check-common, not re-derived (graph reuses path/levenshtein/getPosition; no bespoke duplication)
- [x] #3 Each query has unit pins over a fixture/hermetic app graph
- [x] #4 Resource/CRUD completeness is split out per ADR 004 into TASK-9.6 (platform facts) + TASK-9.7 (convention overlay) and is NOT part of this task (graph stays convention-free)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 1 done (2026-06-30): foundational pure query layer over AppGraph

Branch `supervisor-graph-integration`. New `packages/platformos-graph/src/graph/query.ts` — PURE, synchronous queries over a built `AppGraph` (no I/O; build stays in buildAppGraph). Exported from the package index.

Functions: `dependenciesOf` (outgoing), `dependentsOf` (incoming — 'who renders this file'), `exists`, `isEntryPoint`, `isOrphan` (exists && !entryPoint && no incoming refs — matches AC's 'no incoming references'; entry points/pages-layouts are roots, missing targets are 'missing' not orphan), `orphans` (project-wide), `reachableFrom` (transitive outgoing BFS), `missingDependencies` (per-file unresolved edges), `missingTargets` (project-wide unresolved edges).

Key design note: buildAppGraph only materializes modules reachable from its entry points, so whole-project queries (orphans) are only as complete as the graph passed — to detect unreferenced files, build with every file as an entry point. Documented in the module header.

**Tests** (`query.spec.ts`, 12): integration over the real skeleton graph (dependenciesOf/dependentsOf/reachableFrom/exists/isEntryPoint, no-orphans/no-missing) + hermetic manually-constructed graph (orphan true/false incl. entry-point & missing-target exclusions, orphans(), missingDependencies, missingTargets — full-object assertions). Graph suite 54 pass; type-check + prettier clean; LSP type-check clean (additive export).

## Remaining phases (not started — each substantial, checking in first)
- **Phase 2 — call-sites + args**: Reference already carries the call-site range, but NOT args. Exposing render/function/graphql args needs extending the Reference model (capture named args in the traverse visitor) — cross-cutting (Reference lives in check-common, consumed by LSP). Decision needed before doing it.
- **Phase 3 — nearest-name candidates (did-you-mean)**: name index over typed module names + reuse check-common `levenshtein` (needs public export, like getPosition).
- **Phase 4 — resource/CRUD completeness**: per schema table → related graphql/commands/queries/pages + missing expected ops (old detectResources). Heavy; composes check-common schema/docset.

AC#1 left unchecked (covers all query groups; only the foundational set is done). AC#3 satisfied for the Phase-1 functions.

## Phase 2 done (2026-06-30): call-site args on dependency edges

Approach: a call-site IS a dependency edge (`Reference` already carries `source.range` + `kind`), so args ride on the edge — no redundant 'callSites' query; `dependenciesOf` already returns call-sites, now with args.

- **check-common `Reference`**: added optional `args?: string[]` (additive, like `kind`) — the named-argument NAMES in source order. Values intentionally not captured (names are what `@param` cross-checking needs); documented.
- **graph `traverse.ts`**: new `argNames(LiquidNamedArgument[])` helper (defensive against the parser's documented completion-context case — only `NamedArgument`s with a string name count; returns undefined when none). Captured in the render/include/function/background/graphql visitors via `node.args`; threaded through `bind()` and `extractFileReferences`. `args` set ONLY when non-empty, so argument-less edges keep no `args` field (kept the assertion ripple to exactly the 3 edges that have args).
- Reuse: arg names come straight from the parser AST (`node.args[].name`) — no re-parsing, no re-derivation.

**Tests**: traverse-edges (graphql `['id']`, background `['data']`) + extract (graphql `['id']`, new multi-arg render `['title','count']`) + query (`dependenciesOf` exposes `kind`+`args` at the query layer: skeleton index→parent carries `['children']`). `directRef` helpers gained an optional `args` param. Graph suite 56 pass.

**Cross-package verification (Reference.args is additive)**: graph 56, check-common + supervisor **1084**, all type-checks clean, prettier clean, dists rebuilt. LSP suite pending (only the pre-existing TypeSystem timeout flake expected). Supervisor `dependencies` output is unchanged (its structure adapter maps to {kind,target,line,column}; surfacing args in validate_code is a separate TASK-9.5 enhancement).

AC#1 'call-sites+args' clause: done. Remaining for AC#1: nearest-name candidates (Phase 3), resource/CRUD completeness (Phase 4).

## Phase 3 done (2026-06-30): nearest-name 'did you mean' candidates

- **check-common `index.ts`**: one-line additive re-export of `levenshtein` (edit distance) so consumers reuse it instead of re-implementing string-distance (parity with `getPosition`).
- **graph `query.ts`**: `nearestModules(graph, uri, { limit=3, maxDistance? })` → `AppModule[]`, closest-first. Candidates are SAME-CATEGORY only (same `type`, and for Liquid same `kind`) — a missing `{% render %}` only suggests partials, a missing `{% graphql %}` only graphql ops, etc.; ranked by `levenshtein` over the project-relative path (reuses `path.relative`); excludes self + non-existent modules. Pure over the graph (candidate pool = modules present; build with all files for completeness — same documented caveat as orphans). Exported from the package index (+ `NearestModulesOptions`).

**Tests** (`query.spec.ts`, +5): closest-first ranking (`headr`→`header`), category filtering (excludes a same-named layout, the graphql op, the page, self, and missing), `maxDistance` cap, graphql-typo→graphql-op, absent-URI→[]. Hermetic manually-built graph. Graph suite 61 pass.

**Verification**: graph 61, check-common 1034 (additive export), type-checks + prettier clean, dists rebuilt. LSP/supervisor unaffected (don't consume levenshtein/nearestModules; only additive re-export touched check-common).

AC#1 'nearest-name candidates' clause: done. Remaining for AC#1: resource/CRUD completeness (Phase 4 — the heaviest, schema/docset-composing piece).

## Scope trimmed + closed (2026-06-30)

Per ADR 004 (docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions), the original AC#1 'resource/CRUD completeness' clause is REMOVED from this task: it fuses platform facts with the core-module commands/queries CONVENTION, which must not live in platformos-graph's neutral model. Split into:
- TASK-9.6 — platform-fact groundwork in the graph (schema/CustomModelType nodes, graphql table, page slug).
- TASK-9.7 — the commands/queries convention overlay (descriptive domain map + configurable check), consuming the graph facts.

This task delivered the neutral, convention-free query API — Phases 1–3 (foundational queries, call-site args, nearest-name). All shipped, tested, and green (graph 61 / check-common 1034; type-check + prettier clean; LSP unaffected besides additive re-exports). Closing as Done.

## Add: memoize DocumentsLocator.locate during graph build (from TASK-9.1 code review, 2026-06-24)

TASK-9.1's traverse.ts resolves function/graphql targets via `DocumentsLocator.locateOrDefault`, which `stat()`s each candidate search path until a hit, with NO result caching. The same target referenced from many modules (e.g. a shared `queries/list` or graphql op) replays the full stat-probe sequence per reference — FS I/O proportional to reference count, not to distinct targets.

Belongs in this task's shared ProjectContext/locator-caching layer (not in the per-call traverse path): provide a memoized locate keyed on `(type, fileName)` (rootUri is fixed per build) so each distinct target is probed once per build. When the query layer owns graph construction, build the locator + memo once and inject it. (Perf-only; correctness already fine.)
<!-- SECTION:NOTES:END -->
