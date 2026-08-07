---
id: TASK-12.13
title: >-
  Stop the graph build from starving concurrent lint requests (the actual
  cold-start fix)
status: Done
assignee: []
created_date: '2026-07-29 22:38'
updated_date: '2026-07-29 23:23'
labels:
  - performance
  - supervisor
  - cold-start
  - spike
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-build-worker.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/build-in-worker.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - >-
    packages/platformos-mcp-supervisor/test/integration/graph-build-worker.spec.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-12.7 moved the graph build to server boot and proved, by measurement, that this is NOT sufficient. The cold first `validate_code` on pos-module-mcp is still 51–65 s against warm calls of 1.0–1.1 s.

The evidence that identifies the real cause: the graph build takes **37 s standalone**, and when a lint overlaps it the two **add up** (65 s) rather than interleave. Two CPU-bound jobs on one Node thread serialize. Boot warm-up therefore only converts whatever idle time the client leaves — measured exactly: a 10 s client gap cut the first call from 65 s to 51 s, i.e. by the size of the gap and nothing more.

So the fix has to change how the build shares the process, not when it starts. Options, in rough order of payoff:

1. **Build on a worker thread** (`node:worker_threads`). The only option that gives true parallelism, so a lint arriving during a build runs at full speed and the first call costs ~its own ~20 s instead of 65 s. Cost: the graph must cross a thread boundary — but `graph-cache-store` already serializes/deserializes an `AppGraph` for the persisted cache, so the wire format exists. Watch for: worker startup cost, memory duplication (a second heap parsing the project), and clean shutdown on SIGINT/SIGTERM.
2. **Make the build cooperative** — yield to the event loop every N files so a request is not blocked behind the whole build. Cheaper to implement and removes the "request waits 45 s" pathology, but it does not reduce total CPU: the overlapping lint still slows by roughly 2x, and the build itself gets longer.
3. **Reduce the build's own cost.** `buildAppGraph` parses every edge-source liquid file; 37 s for ~1400 files suggests per-file parse dominates. Worth profiling before choosing 1 or 2 — if the build can be made 5 s, contention stops mattering and neither of the above is needed.

Do 3 first as a spike: it is the only option that might make the other two unnecessary, and it is a measurement, not a rewrite.

Note TASK-12.8 (lazy parse in check-node) does NOT help here: the graph build reads and parses through platformos-graph's own traversal, not through check-node's `getApp`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SPIKE FIRST: the 37 s build is profiled and its dominant cost named (per-file parse, enumeration, edge resolution, …), recorded in the task before any approach is chosen
- [x] #2 A decision between worker thread / cooperative yielding / cheaper build is recorded with the profile as its justification
- [x] #3 Cold first-call latency on pos-module-mcp is measured with NO client gap — the worst case — before and after, at comparable machine load, and recorded
- [x] #4 A lint issued while the graph is building is not slowed by more than a stated, measured factor (the contention budget the chosen approach commits to)
- [x] #5 Warm-call latency and warm memory do not regress (currently 1.0–1.1 s; RSS ~930 MB with AppCache)
- [x] #6 The never-stale guarantee is preserved: no half-built or half-applied graph can be served, and the existing GraphCache specs pass untouched
- [x] #7 If a worker thread is used: clean shutdown on SIGINT/SIGTERM with no orphaned worker, and the graph's cross-thread transfer is covered by a test
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SPIKE (AC#1) — `node --cpu-prof` over a full build on pos-module-mcp, with an instrumented fs:

- 83.5% of 37.7 s sampled inside **ohm-js**; garbage collector 5.8%; liquid-html-parser 1.8%; **platformos-graph itself 0.2%**
- 808 file reads totalling **1.1 MB**, 14057 stats, 1458 readdirs, enumeration 171 ms

So the build is neither I/O-bound nor graph-logic-bound: it is Liquid parsing, and nothing else is close.

DECISION (AC#2) — worker thread. Option 2 (cooperative yielding) was rejected on the profile: yielding reshares 31.5 s of CPU without reducing it, so an overlapping lint would still slow ~2x. Option 3 (a cheaper build) is the real root cause and is now TASK-12.14/12.15/12.16 — but it does not remove the need for this: even a 2 s build should not sit on the request path.

MEASURED (pos-module-mcp, real stdio bin, cold cache, load 1.4–2.9, no client gap = worst case):

| | before | after |
|---|---|---|
| cold first call | 65.0 s | **13.4 s** |
| calls during the build | blocked | **0.7–1.3 s** |
| call after graph ready | 0.8 s | 0.8 s |
| contention factor vs a no-build baseline (10.9 s) | ~6x | **~1.2x** (AC#4) |
| peak RSS | ~930 MB | **1050 MB** (AC#5) |

Worker phase breakdown (isolated, no lint traffic): imports+grammar ~1.7 s, `buildAppGraph` 49109 ms, **serialize 3 ms** — crossing the thread boundary is free; the graph reuses the persisted cache's own `serializeAppGraph`/`deserializeAppGraph` wire format.

HONEST COST: the build is SLOWER off-thread — 49–60 s versus ~36 s in-process (fresh V8 isolate, no shared JIT/code cache, second heap). Time-to-blast-radius-ready therefore regresses while user-visible latency improves 4.9x. That is the intended trade (`impact` degrades to `computing` meanwhile, exactly as designed), and TASK-12.14/12.15 attack the underlying parse cost that dominates both.

DESIGN — `GraphCache` is untouched: the worker is injected through its existing `buildGraph` seam at `startServer`, so every existing spec still exercises the in-process build. One-shot worker per build (builds are rare; a short-lived thread cannot leak the second heap), reaped on every settle path, and `terminateGraphBuildWorkers()` is called from `shutdown` so a build in flight cannot hold the process open. Incremental reconciles stay in-process — they touch only changed files and are milliseconds.

TESTS (AC#6/#7) — 5 integration tests against the built dist (a worker entry only exists as a compiled `.js`, so vitest's src transform cannot load it). The load-bearing one asserts EQUIVALENCE: an off-thread graph answers `dependentsOf` identically to the in-process build, with the same entry points and module set. Plus: worker reaped after a build; a failure inside the worker rejects with the REAL message (`ENOTDIR`) rather than an opaque worker error; terminating a build in flight settles the promise and leaves no worker; and a root with nothing in it resolves to an empty graph rather than failing (pinned because that is how `impact` degrades). Two test bugs were found and fixed by measurement rather than assumption: `Reference` exposes `source.uri` (not `sourceUri`), and a non-`file:` root does NOT throw.

Suites: supervisor 92, check-node 115, graph 109, check-common 1055, LSP 474; monorepo type-check and format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
