---
id: TASK-9.15
title: >-
  Warm, incremental, persisted GraphCache — always-fresh blast radius at best
  performance
status: Done
assignee:
  - '@Filip'
created_date: '2026-07-02 06:46'
updated_date: '2026-07-03 07:39'
labels:
  - mcp-supervisor
  - platformos-graph
  - performance
  - architecture
dependencies:
  - TASK-9.14
references:
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
  - packages/platformos-graph/src/graph/serialize.ts
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - SUPERVISOR-GRAPH-INTEGRATION.md
modified_files:
  - packages/platformos-graph/src/graph/incremental.ts
  - packages/platformos-graph/src/graph/deserialize.ts
  - packages/platformos-graph/src/graph/deserialize.spec.ts
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/utils/index.ts
  - packages/platformos-graph/src/index.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.spec.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache-store.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache-store.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - SUPERVISOR-GRAPH-INTEGRATION.md
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. TASK-9.10 shipped a correct, never-stale GraphCache, but it is not performance-optimal: (a) it FULL-rebuilds (~22s on 1,500 nodes) on ANY change, so blast-radius is `computing` for ~22s after every file write; (b) it fingerprint-scans (~400ms) on every request; (c) cold start is a full ~22s build. This task makes the graph ALWAYS fresh AND fast, using proven incremental-computation + persistence techniques (rust-analyzer/Salsa, LSP didChangeWatchedFiles, TS --incremental, bundler HMR) — we apply, not invent.

The never-stale mandate is preserved throughout: the fingerprint remains the AUTHORITY; incremental apply is driven by the fingerprint diff; any detected inconsistency falls back to a full rebuild. Watch = speed; fingerprint = truth.

PHASES (each shippable; ordered by ROI):

PHASE 1 — Incremental apply (biggest win, lowest risk; needs TASK-9.14).
Replace full-rebuild-on-change with: on a request, compute the fingerprint, DIFF it against the built graph's fingerprint → the set of changed/added/deleted files, and apply them via `applyFileChange` (O(changed files), ~ms) — then serve FRESH IMMEDIATELY. This eliminates BOTH the 22s rebuild and the `computing`-after-write gap: blast-radius becomes always-fresh-and-instant for edits. (Subsumes the bounded-await idea: small changes apply synchronously, so there is no `computing` for them; only the very first cold build has no prior graph → Phase 2.) Keep a periodic/where-inconsistent full-rebuild reconciliation as the correctness backstop.

PHASE 2 — Persistence (geoid-style cold start).
Serialize the built graph (`serializeAppGraph`) + its per-file fingerprints to a cache file on disk. On server start, LOAD it and incrementally reconcile the delta (apply changes for files whose fingerprint moved) instead of a 22s cold build. Persist the derived MODEL (the graph), not the ASTs — the graph is the compact summary (the "geoid grid"); retrieval is the existing O(1) query API. Version the cache format; invalidate on version/root mismatch; the fingerprint still gates correctness after load.

PHASE 3 — Background freshness + scoped walk (removes the residual per-request cost).
Add fs.watch to keep the graph fresh in the BACKGROUND (incremental apply on watch events) so the request path does no scan at all; keep the fingerprint reconciliation as the safety net for missed/unsupported watch events (network FS, inotify limits, macOS quirks) — NEVER trust the watcher alone. Also scope the file walk (fingerprint + build enumeration) to platformOS dirs (app/ + modules/*/public|private) instead of the whole tree (cuts the ~400ms; today it walks react-app/ etc.). Consider sharing one project-scan/fingerprint primitive with TASK-9.13 (lint) so the tree is walked once.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PHASE 1: on a fingerprint mismatch the cache applies only the changed files via platformos-graph `applyFileChange` (no full rebuild) and serves a FRESH graph immediately; blast-radius is no longer `computing` after a single-file write (test: write a file, next call is `computed` with updated dependents, with no full rebuild).
- [x] #2 PHASE 1: the incremental-apply result equals a from-scratch build for the same disk state (leans on TASK-9.14's invariant); a consistency/backstop path triggers a full rebuild if incremental state is ever detected inconsistent.
- [x] #3 PHASE 1: never stale preserved — the fingerprint remains authoritative; a change is never served against the old graph.
- [x] #4 PHASE 2: the graph + per-file fingerprints persist to a versioned cache file; on start the cache LOADS + incrementally reconciles the delta instead of a full cold build (measured cold-start improvement recorded).
- [x] #5 PHASE 2: cache file is invalidated on format-version / root mismatch; the fingerprint still gates correctness post-load (a corrupt/stale cache never yields a wrong answer — falls back to rebuild).
- [ ] #6 PHASE 3: fs.watch keeps the graph fresh in the background (incremental apply on events) so the request path performs no per-call full scan on the steady state; the fingerprint reconciliation remains as the safety net for missed/unsupported watch events (never trusts the watcher alone).
- [x] #7 PHASE 3: the file walk (fingerprint + build enumeration) is scoped to platformOS dirs, not the whole tree; measured warm-path cost drop recorded; shared scan primitive with TASK-9.13 evaluated.
- [x] #8 Measured on the real ~1,500-node project: before/after for cold start, post-write freshness latency, and steady-state per-call cost.
- [ ] #9 TDD across phases: incremental-apply-via-diff correctness + never-stale, persistence load/reconcile/invalidate, watch + safety-net reconciliation; supervisor + graph suites + type-check + format + frozen-lockfile green.
- [ ] #10 Docs: SUPERVISOR-GRAPH-INTEGRATION.md + ADR updated with the final freshness architecture (incremental + persisted + watched, fingerprint-authoritative).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PHASE 1 DONE (incremental apply via fingerprint diff). packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts: lookup() now, when a graph already exists and the fingerprint moved, DIFFS built.fingerprint→current (diffFingerprints → added/modified/deleted) and applies only the changed files via the new applyChange seam (default = platformos-graph applyFileChange), then serves the updated graph IMMEDIATELY — no full rebuild, no `recomputing` gap after a write. Reconciliations are serialized on a reconcileChain promise so concurrent lookups can't interleave mutations of the shared graph (each queued applyDiff re-checks equality and no-ops if caught up). If incremental apply throws, fallbackToRebuild() discards the graph and triggers a full background rebuild — a half-applied graph is never served (AC#2 backstop). Cold start (no prior graph) still background-builds (Phase 2 will load a persisted graph there). Fingerprint remains the authority; built.fingerprint is set to the diffed target after apply (AC#3). settle() now also drains reconcileChain.

TESTS (graph-cache.spec.ts, 10): incremental-serve-no-rebuild, added/modified/deleted diff order, apply-failure→rebuild fallback, concurrent-reconcile-no-double-apply; the real-fs integration test now asserts the edited caller's dependent appears IMMEDIATELY via real applyFileChange (no recomputing). VERIFY: supervisor+graph suites 154/154 green (incl. stdio smoke), tsc --noEmit clean, prettier clean.

STILL TODO: Phase 2 (persist serializeAppGraph + fingerprints to a versioned cache file; load+reconcile on cold start) — AC#4,#5. Phase 3 (fs.watch background freshness + safety-net reconciliation; scope the walk to platformOS dirs; shared scan primitive with 9.13) — AC#6,#7. AC#8 measurements, AC#10 docs. Paused for approval before Phase 2 per phased-execution rule.

PHASE 2 DONE (persistence — warm cold start). New platformos-graph/src/graph/deserialize.ts exports deserializeAppGraph (inverse of serializeAppGraph): rebuilds modules+edges AND seeds the module identity cache (via new exported internModule in module.ts) so a loaded graph reconciles via applyFileChange EXACTLY like a fresh build; entry points restored from persisted URIs; dangling edges skipped defensively. (assertNever return type corrected to `never` to type the exhaustive switch.) deserialize.spec.ts (5): round-trip identity, reverse-index queryable, restored-graph-reconciles-like-full-build (proves seeding), added/deleted on restored graph, dangling-edge/no-entry-points guard.

New supervisor graph-cache-store.ts: versioned cache format (CACHE_FORMAT_VERSION=1) with encodeCacheFile/decodeCacheFile; decode is defensive — unparseable/wrong-version/wrong-root/structurally-invalid → null (never throws). graph-cache-store.spec.ts (4): round-trip, version-bump→null, root-mismatch→null, corrupt/missing-fields→null.

graph-cache.ts: cold lookup now hydrate()s — first cold attempt tries the persisted cache (load → built with the PERSISTED fingerprint, so the next lookup reconciles the on-disk delta) and only full-builds if no usable cache; persists (off request path, coalesced via persistScheduled/persistChain, atomic temp+rename) after each build AND reconcile. cachePath option (+ readCacheFile/writeCacheFile seams); defaultGraphCachePath(rootUri) = <tmpdir>/platformos-mcp-supervisor/graph-<sha256>.json; server.ts wires it. graph-cache.spec.ts +3 persistence integration tests (real fs+build): persist-after-build + warm-from-disk-no-rebuild, reconcile-delta-after-warm, corrupt→rebuild.

MEASURED (real marketplace-dcra, 2170 nodes / 1921 entry points): cold FULL build 70,218 ms → WARM persisted load 37 ms (+delta reconcile) ≈ 1900×; serialize+stringify 48 ms (1.4 MiB). Post-write freshness: was ~22s `computing`, now immediate (Phase 1). AC#8 cold-start + post-write recorded in §10.2; steady-state per-call (fingerprint scan ~400ms) unchanged — Phase 3 scoped-walk target.

VERIFY: supervisor+graph suites 166/166 green (incl. stdio smoke with persistence live), both packages tsc --noEmit clean, prettier clean, both dists rebuilt. Docs: SUPERVISOR-GRAPH-INTEGRATION.md §10 added + task ledger updated.

STILL TODO (Phase 3): fs.watch background freshness + fingerprint safety-net (AC#6); scope the walk to platformOS dirs + shared scan primitive with 9.13 (AC#7); complete AC#8 steady-state metric + AC#9 watch tests + AC#10 'watched' architecture doc. Paused for approval before Phase 3.

PHASE 3A DONE (scoped source walk). graph-cache.ts: the fingerprint enumeration (and, via fingerprint keys, the build entry points) now walks only the platformOS source roots — SOURCE_ROOTS = app/, marketplace_builder/, modules/ — via new enumerateEdgeSources() (Promise.all of recursiveReadDirectory per root, joined), instead of the whole project tree from rootUri. Per the file-type classifier these are the ONLY places a Page/Layout/Partial can live (incl. nested app/modules/<m>/... reached via app/), so the enumerated set is provably identical, only cheaper. Never-stale preserved (the set the graph is built/reconciled from is unchanged).

TESTS (graph-cache.spec.ts +2, real fs): (1) enumerates edge sources across app/ + marketplace_builder/ + modules/ + nested app/modules/ — asserts the EXACT entry-point set captured via the buildGraph seam (whole-value); (2) never walks non-platformOS subtrees — a decoy react-app/src/.../Widget.liquid is never read (readDirectory spy: no /react-app, project root itself never read) and is not a graph node.

MEASURED (marketplace-dcra, 1921 edge sources, warm medians of 5): directory walk 769ms → 175ms (4.4×); full fingerprint (walk + stat) 541ms → 320ms (1.7×; per-file stat is the irreducible remainder). Enumerated set BYTE-IDENTICAL to the whole-tree walk (1921 = 1921, zero diff either direction) — proves the scoping loses no real source.

SHARED-SCAN-WITH-9.13 EVALUATED, DECLINED: lint's getAppFilePaths uses node `glob` in check-node (browser-incompatible) over all 4 source types; the graph cache uses the browser-safe AbstractFileSystem walk over edge-source liquid only — different mechanism, domain, and package boundary. Coupling them buys nothing the scoped walk didn't already; not worth the entanglement.

VERIFY: supervisor+graph suites 168/168 green (incl. stdio smoke), supervisor tsc --noEmit clean, prettier clean, supervisor dist rebuilt. Docs §10.2 updated (Phase 3A measured table + shared-scan evaluation) + ledger.

3B (fs.watch) DEFERRED by decision: on the validate_code path the fingerprint scan runs concurrently with lint's multi-second parse, so it adds ≈0 wall-clock today — fs.watch would optimize an off-critical-path cost at the price of real platform-specific watcher complexity (recursive-watch gaps, inotify limits, atomic-save renames, network FS), and the never-stale mandate forces keeping the fingerprint scan as the authority/backstop regardless. Recommend closing 3B as won't-do-now unless profiling shows the scan on the critical path. AC#6 (fs.watch) intentionally left unchecked; AC#8 steady-state metric now recorded; AC#9/#10 done for the shipped phases.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped Phases 1, 2, and 3A of the warm/incremental/persisted GraphCache; verified end-to-end on the real project (marketplace-dcra, 2170 nodes).

PHASE 1 — incremental apply: a fingerprint move on a built graph diffs the fingerprint and applies only changed files via platformos-graph applyFileChange (TASK-9.14), serving fresh immediately — no rebuild, no `computing` gap after a write. Serialized reconciles; apply-failure falls back to full rebuild; fingerprint stays authoritative.
PHASE 2 — persistence: versioned cache file (serializeAppGraph + deserializeAppGraph + per-file fingerprints); cold start LOADS + reconciles the delta instead of rebuilding. Measured: 62.7s cold build → 406ms warm load (0 rebuilds), 154×. Corrupt/wrong-version/wrong-root/dangling-edge cache → rejected → rebuild (never a wrong answer).
PHASE 3A — scoped walk: enumeration scoped to app/ + marketplace_builder/ + modules/ (SOURCE_ROOTS); measured byte-identical set to the whole-tree walk (1921=1921), walk 4.4× faster, full fingerprint 1.7×.

AC#8 metrics recorded; §10 of SUPERVISOR-GRAPH-INTEGRATION.md documents the incremental+persisted+scoped architecture; graph + supervisor suites + type-check + format green throughout. Also folded in the later code-review fixes to this cache: reconcile never-stale concurrency guard + recompute-inside, fileFingerprint reuse (shared with check-node AppCache), persist coalescing, and decode referential-integrity.

PHASE 3B (fs.watch background freshness, AC#6 + its watch-specific TDD/docs) was DEFERRED by decision — the fingerprint scan runs concurrent with lint so it adds ≈0 wall-clock today; not worth the platform-specific watcher complexity unless profiling shows the scan on the critical path. Split to TASK-9.20 so it is tracked. Closing on the three shipped phases.
<!-- SECTION:FINAL_SUMMARY:END -->
