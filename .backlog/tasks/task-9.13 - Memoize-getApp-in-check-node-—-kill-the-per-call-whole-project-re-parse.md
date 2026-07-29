---
id: TASK-9.13
title: Memoize getApp in check-node — kill the per-call whole-project re-parse
status: Done
assignee:
  - Filip
created_date: '2026-07-02 06:45'
updated_date: '2026-07-02 08:16'
labels:
  - platformos-check-node
  - performance
  - mcp-supervisor
dependencies: []
references:
  - packages/platformos-check-node/src/index.ts
  - SUPERVISOR-GRAPH-INTEGRATION.md
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The dominant per-call latency of `validate_code` is NOT the graph — it is check-node's `getApp` (inside `lintBuffer`), which globs and PARSES the entire project on EVERY call, with no memoization. On a ~1,500-node real project this is multiple seconds per `validate_code`. It dwarfs the graph work (the ~400ms fingerprint scan is only "hidden" because it runs concurrently behind this). Fixing it is the single biggest per-call speedup and benefits ALL of validate_code, not just the graph path.

WHAT. Memoize the parsed `App` (+ config) per project root in `getAppAndConfig`/`getApp`, so repeated `lintBuffer` calls reuse the parsed project and only overlay + re-parse the in-flight buffer. Invalidate correctly: the cache must NEVER lint against a stale project (mirrors the supervisor's never-stale mandate) — reconcile via a cheap per-file fingerprint (mtime:size) or fs-change signal, re-parsing only changed files. A `.platformos-check.yml` change invalidates config.

CONSTRAINTS.
- check-node is a shared package (LSP-adjacent consumers). Keep the change additive/opt-in or transparently safe; do not alter `lintBuffer`'s contract.
- Correctness first: a stale lint is as misleading as a stale graph. Fingerprint/track invalidation; when in doubt, re-read.
- This coordinates with TASK-9.14 (the graph cache also fingerprints the same files) — consider a shared project-scan/fingerprint primitive so lint and graph do not each walk the tree independently.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repeated lintBuffer calls for the same project reuse a memoized parsed App instead of re-globbing + re-parsing the whole project each call (verified: N calls do not trigger N full project parses).
- [x] #2 Only the overlaid in-flight buffer is (re)parsed per call; unchanged project files are reused.
- [x] #3 Never stale: a changed project file (or .platformos-check.yml) is detected and reconciled (changed files re-parsed / config reloaded) before linting — a cheap fingerprint or fs signal, never a stale parse.
- [x] #4 lintBuffer's public contract is unchanged for existing consumers (LSP/CLI); the memoization is transparent or opt-in.
- [x] #5 Measured per-call latency drop on the real ~1,500-node project (before/after recorded).
- [x] #6 TDD: cache reuse, buffer-overlay correctness, invalidation on file/config change; check-node suite + type-check + format green.
- [x] #7 Coordinate with TASK-9.14: evaluate a shared project-scan/fingerprint primitive so lint and the graph cache do not each walk the tree.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
MEASURED (real marketplace-dcra): getApp globs+parses 2,869 files in ~84s COLD. This is the dominant per-call cost of validate_code (dwarfs the graph's ~400ms). Confirms the task. (lintApp/coreCheck also runs whole-project per call but couldn't be cleanly measured — it pulls the docs manager/network; scoped OUT as a potential follow-up: scope checks to the buffer file.)

DESIGN DECISION: OPT-IN cache (safest for a shared package). getApp stays byte-identical for existing consumers (CLI appCheckRun/check, backfill-docs) unless a cache is passed — zero risk to them, no global mutable state, no mtime-race in their test loops. The supervisor opts in.

APPROACH (check-node):
- New `AppCache` class (opt-in, caller-held): keyed by file uri → { fingerprint (mtime:size), source: parsed SourceCode }. Exposes internal get/set/prune used by getApp; caller persists one per project.
- `getApp(config, cache?)`: glob+filter UNCHANGED (current file set, applies current config's ignore filter — so config-driven set changes are captured each call). If no cache → today's behavior (parse all). If cache → reconcile: stat each path → mtime:size; REUSE cached parsed SourceCode when the fingerprint matches; re-parse only changed/new; prune removed. Returns app in the same (paths) order.
- Thread cache: `getAppAndConfig(root, configPath?, cache?)` → getApp(config, cache); `LintBufferParams` gains optional `cache?: AppCache`; lintBuffer passes it. All additive/optional.
- NEVER STALE: per-file mtime:size fingerprint; config loaded fresh each call (checks always current); the filter re-runs each call so add/remove/config-set changes are reconciled. When a fingerprint matches, the parsed AST is reused (the win); when it moves, re-parse. Export the fingerprint helper so the supervisor GraphCache (9.15) can adopt one shared node-level scan primitive (AC #7).

APPROACH (supervisor):
- SupervisorContext gains `appCache: AppCache` (created per server in startServer, sibling to graphCache).
- lint adapter: `runLint(params, appCache)` passes cache to lintBuffer; runValidateCode passes ctx.appCache; the injectable ValidateCodeAdapters.lint signature gains the cache arg (fakes ignore it). Symmetric with runImpact(params, graphCache).

TDD: check-node AppCache/getApp tests on a small fixture — reuse (unchanged files return the SAME SourceCode instance = not re-parsed), invalidation on modify (new instance) / add / remove, config-filter change, no-cache path unchanged. Supervisor: lint adapter still green with the cache threaded; validate-code orchestration unchanged. MEASURE getApp cold (~84s) vs warm-with-cache (expect glob+stat only, seconds) on the real project for AC #5. Then check-node + supervisor suites + tsc + format + frozen-lockfile.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (opt-in cache, safest for a shared package). check-node: new `AppCache` class + exported `fileFingerprint(path)` (mtime:size) + `AppSourceCode` alias. `getApp(config, cache?)` — extracted glob+filter into `getAppFilePaths`; with a cache it reconciles (stat each path, REUSE parsed SourceCode when fingerprint matches, re-parse changed/new, prune removed); WITHOUT a cache it is byte-identical to before (parse all). Threaded `cache?` through `getAppAndConfig` + `LintBufferParams` + `lintBuffer`. All additive/optional — CLI (appCheckRun/check), backfill-docs, and the LSP (which doesn't import check-node) are unaffected.

SUPERVISOR: SupervisorContext gains `appCache` (one `new AppCache()` per server in startServer, sibling to graphCache); runLint(params, cache?) passes it to lintBuffer; runValidateCode passes ctx.appCache to the lint adapter (symmetric with runImpact(params, graphCache)).

MEASURED (real marketplace-dcra, 2,869 files): cold getApp (parse all) 157s → warm getApp (cache) 5.4s, with 2869/2869 instances REUSED (zero re-parse). ~29x on the warm path; correct (never stale). The residual 5.4s is the glob+stat reconciliation scan — further reducible via the scoped-walk / shared-scan primitive (TASK-9.15 P3).

SHARED PRIMITIVE (AC#7): exported `fileFingerprint` from check-node so the supervisor GraphCache (TASK-9.15) can adopt ONE node-level fingerprint definition instead of its own node:fs stat.

VERIFICATION: check-node 105 green (incl. 6 new app-cache.spec: reuse-by-identity, modify/add/remove invalidation, no-cache-path-unchanged, never-stale-via-lintBuffer); supervisor 55 green; LSP 467 (466 under parallel load = the documented TypeSystem flake, unrelated — LSP doesn't import check-node); direct tsc clean (check-node + supervisor); format:check clean; frozen-lockfile clean, zero churn; check-node dist rebuilt.

FOLLOW-UP (out of scope, recommend a task): lintApp/coreCheck still runs ALL checks over the WHOLE project every call (then lintBuffer filters to the buffer's file). getApp memoization removes the PARSE cost but not the CHECK cost. If coreCheck proves significant after this, scope checks to the buffer file (+ cross-file context) — a check-common coreCheck API change. Couldn't be cleanly measured (pulls the docs manager/network).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Killed the dominant per-call cost of validate_code: check-node's getApp re-parses the whole project on every lintBuffer call (measured ~157s cold on the real 2,869-file marketplace-dcra). Added an OPT-IN, never-stale AppCache so repeated calls reuse the parsed project and only changed files re-parse.

check-node: new AppCache class + exported fileFingerprint (mtime:size) + AppSourceCode alias. getApp(config, cache?) reconciles against the cache (reuse-by-fingerprint, re-parse changed/new, prune removed) when a cache is passed, and is byte-identical to before when not. Threaded cache? through getAppAndConfig / LintBufferParams / lintBuffer — all additive/optional, so CLI, backfill, and the LSP are unaffected. Never stale: reuse gated on per-file fingerprint; file set + config filter re-evaluated every call.

supervisor: SupervisorContext gains a per-server appCache; the lint adapter and runValidateCode thread it (symmetric with the graph cache).

Measured: cold getApp 157s -> warm 5.4s with 2869/2869 instances reused (zero re-parse). TDD: 6 new check-node app-cache tests (reuse-by-identity, modify/add/remove invalidation, no-cache path unchanged, never-stale via lintBuffer) + supervisor wiring. check-node 105, supervisor 55, LSP 467 (the 1 fail is the known TypeSystem parallel-load flake; LSP doesn't import check-node); tsc + format + frozen-lockfile clean, zero lockfile churn; dist rebuilt.

Exported fileFingerprint as the shared scan primitive for TASK-9.15 to adopt. Follow-up recommended: coreCheck still lints the whole project per call (parse fixed, check not) — scope checks to the buffer file if it proves significant.
<!-- SECTION:FINAL_SUMMARY:END -->
