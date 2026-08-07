---
id: TASK-9.17
title: >-
  Move edge-source enumeration + fingerprint domain into platformos-graph (ADR
  003 — remove supervisor's leaked graph-domain knowledge)
status: Done
assignee: []
created_date: '2026-07-02 13:03'
updated_date: '2026-07-07 12:15'
labels:
  - platformos-graph
  - mcp-supervisor
  - architecture
  - code-review
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-common/src/path-utils.ts
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
modified_files:
  - packages/platformos-graph/src/graph/edge-sources.ts
  - packages/platformos-graph/src/graph/edge-sources.spec.ts
  - packages/platformos-graph/src/index.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY (code-review finding #8, altitude). The supervisor's GraphCache re-encodes graph-domain knowledge that ADR 003 says lives in platformos-graph: `SOURCE_ROOTS = ['app','marketplace_builder','modules']`, `isEdgeSource(uri) = isLayout||isPage||isPartial`, and `enumerateEdgeSources` (the scoped walk that produces BOTH the fingerprint domain AND the build's entry points). "Which files are edge sources" and "where platformOS sources live" is exactly the classification `getFileType`/`build.ts` already own. Nothing forces the supervisor's copy to agree with them.

THE RISK (never-stale-adjacent): if a new source root or file-type convention is added to `getFileType` / `build.ts` (a new partial location, a new app root alias, layouts move), the supervisor's `SOURCE_ROOTS`/`isEdgeSource` silently diverge. The fingerprint scan then omits real edge sources → the graph is built with an incomplete entry-point set → blast-radius under-reports dependents. That is a wrong "safe to change" produced NOT by staleness but by an incomplete domain model — with no test forcing the two definitions to agree. This is the same class of bug the never-stale mandate exists to prevent.

RELATED: code-review #5 (fingerprint format) is already resolved — the supervisor reuses check-node's exported `fileFingerprint`. This task is the remaining half: the edge-source SET + its enumeration.

WHAT. Make platformos-graph (or check-common, wherever the classifiers live) the single owner of "enumerate the edge-source files under a project root", and have the supervisor GraphCache consume it instead of its own `SOURCE_ROOTS`/`isEdgeSource`/`enumerateEdgeSources`. Options to weigh during design:
 - Export an `enumerateEdgeSources(fs, rootUri)` (or `edgeSourceFiles`) primitive from platformos-graph that reuses `isLayout/isPage/isPartial` + the canonical source-root knowledge, scoped to the platformOS dirs (preserving the TASK-9.15 Phase-3A scoped-walk win — set must stay byte-identical to the whole-tree walk on a real project).
 - Consider whether `buildAppGraph`'s full-build discovery (entryPoints===undefined) and this scoped edge-source enumeration should share one internal walk, so there is ONE definition of "edge source" and "source root" in the graph package.
 - Keep the supervisor's cache as a pure consumer: it calls the graph primitive for the file set, still fingerprints via check-node `fileFingerprint`, still owns caching/persistence/reconcile.

GUARDRAIL. Add a test that pins the enumerated edge-source set against the file-type classifier (e.g. every enumerated URI is `isEdgeSource`, and a fixture covering app/, marketplace_builder/, modules/, app/modules/ nested) so the graph-owned definition cannot silently drift. Preserve the never-stale + scoped-walk guarantees (byte-identical set to the whole-tree walk).

Working dir: ~/Work/platformos-tools/platformos-tools. NON-BLOCKING for the current PR — the shipped behavior is correct today; this is an architectural consolidation to prevent future drift.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 platformos-graph (or check-common) exports a single canonical edge-source enumeration primitive that reuses isLayout/isPage/isPartial + the source-root knowledge; the supervisor GraphCache consumes it and no longer defines its own SOURCE_ROOTS / isEdgeSource / enumerateEdgeSources
- [x] #2 The enumerated edge-source set stays byte-identical to today's on a real project (TASK-9.15 Phase-3A scoped-walk win preserved; verified on marketplace-dcra: 1921 files, zero diff vs whole-tree walk)
- [x] #3 A test pins the enumerated set to the file-type classifier so the graph-owned 'edge source' + 'source root' definition cannot silently drift from getFileType/build.ts
- [x] #4 Never-stale preserved: the fingerprint domain = the enumerated edge-source set = the build's entry points (one definition, one owner); supervisor still fingerprints via check-node fileFingerprint
- [x] #5 Whether buildAppGraph's full-build discovery and the scoped edge-source enumeration can share one internal walk is evaluated (share or document why not)
- [x] #6 graph + supervisor suites + type-check + format + frozen-lockfile green; no regression to buildAppGraph / GraphCache behavior
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the edge-source enumeration + fingerprint domain out of the supervisor into platformos-graph (ADR 003), so "which files are edge sources" and "where sources live" have ONE owner beside the classifier — the supervisor can no longer silently drift and under-report dependents.

New platformos-graph/src/graph/edge-sources.ts (exported from the package index):
- `isEdgeSource(uri)` = isLayout || isPage || isPartial — the canonical edge-source predicate, deriving entirely from the file-type classifier (FILE_TYPE_DIRS), so "which files" has a single source of truth.
- `enumerateEdgeSources(fs, rootUri)` — the canonical scoped walk (SOURCE_ROOTS = app/marketplace_builder/modules), moved VERBATIM from the supervisor (byte-identical algorithm → identical set on any project; AC#2).

Supervisor graph-cache.ts is now a PURE CONSUMER: deleted its local isEdgeSource / SOURCE_ROOTS / enumerateEdgeSources and the now-unused isLayout/isPage/isPartial/recursiveReadDirectory imports; imports enumerateEdgeSources from @platformos/platformos-graph; computeFingerprintFromDisk calls it unchanged. Still owns fingerprinting (check-node fileFingerprint), caching, persistence, reconcile (AC#4).

Guardrail (AC#3) — edge-sources.spec.ts (MockFileSystem, no disk): the load-bearing test asserts the SCOPED walk equals a WHOLE-TREE walk filtered by isEdgeSource over a fixture with edge sources under every root (app/, app/lib, marketplace_builder/, top-level modules/, nested app/modules/) plus non-edge leaves (graphql/schema/asset) and a bundled react-app/ sibling. If a source root is added to the classifier but not to SOURCE_ROOTS, the whole-tree walk finds files the scoped walk misses → test fails. Also pins isEdgeSource === isLayout||isPage||isPartial directly and asserts the exact expected set.

AC#5 (shared walk) — evaluated and declined, documented in the edge-sources.ts JSDoc: buildAppGraph's full-build discovery gathers a DIFFERENT domain (render entry points = pages+layouts only, +schema, whole-tree) vs this (page+layout+partial, scoped — the cache needs partials as entry points for complete dependents). They share the isLayout/isPage/isPartial predicate (the part that must not drift); sharing the walk would conflate two entry-point domains.

Verification (AC#6, all green): no stale graph-domain refs remain in the supervisor; graph type-check + supervisor type-check clean (tsc exit 0); graph suite 105 (+4 edge-sources), supervisor suite 76 UNCHANGED — the existing scoped-walk regression tests (enumerate across all three roots + react-app pruned) pass as-is, proving the consumer swap is behavior-preserving; prettier clean; yarn install --frozen-lockfile clean with zero yarn.lock churn. graph + supervisor dist rebuilt.

NOTE (not edited, flagged): SUPERVISOR-GRAPH-INTEGRATION.md §10.2 Phase-3A still describes SOURCE_ROOTS as living in the supervisor cache — now stale (moved to graph); fold into the next doc pass.
<!-- SECTION:FINAL_SUMMARY:END -->
