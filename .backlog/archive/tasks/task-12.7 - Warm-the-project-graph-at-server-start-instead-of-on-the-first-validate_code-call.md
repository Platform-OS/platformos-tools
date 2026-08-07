---
id: TASK-12.7
title: >-
  Warm the project graph at server start instead of on the first validate_code
  call
status: Done
assignee: []
created_date: '2026-07-29 21:42'
updated_date: '2026-07-29 22:37'
labels:
  - performance
  - supervisor
  - cold-start
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - packages/platformos-mcp-supervisor/test/integration/stdio-smoke.spec.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On this branch the first `validate_code` call after a server start takes **46–58 s** when no graph cache file exists, measured over the real MCP stdio bin on pos-module-mcp (162-file app). Warm calls are 0.9–1.0 s.

Cause, measured with the adapters directly: `runImpact` itself returns in 96–145 ms (it reports `computing` and builds in the background), and the cold graph build takes **37.3 s** on its own. But the build shares the single Node event loop with the lint, so the lint that overlaps it inflates from ~20 s to 58 s. The cost is not the build alone — it is the contention.

`startServer` currently only CONSTRUCTS the cache; its own comment states the graph is "warmed from a persisted graph on the first blast-radius request (else built lazily in the background)". So the entire cold cost lands on the user's very first call, which is exactly the call an agent makes before its first write.

Kicking the warm-up off during `startServer` moves it off the request path: MCP clients connect at session start and typically do not call a tool in the same instant, so most of the build happens before the first request instead of underneath it. This does not make the build cheaper — see the sibling task for that — it stops it from being charged to a request.

Care needed: `startServer` must not AWAIT the warm-up (that would delay `initialize` and, with it, the client handshake); a rejected warm-up promise must not produce an unhandled rejection or a failed startup; and the existing degrade contract must hold — blast radius is a secondary signal and may never sink or delay the lint gate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The graph warm-up is initiated during `startServer` without being awaited, so `initialize` latency is unchanged (measured before/after)
- [x] #2 A warm-up failure is logged and leaves the server fully functional — no unhandled rejection, no failed startup, lint still answers
- [x] #3 Cold first-call latency on pos-module-mcp is measured and recorded before and after, with the graph cache file removed to force a true cold start
- [x] #4 A test asserts the warm-up starts without being awaited (e.g. the graph build seam is invoked during startServer while `initialize` still resolves promptly)
- [x] #5 Concurrent warm-up and a first request cannot produce two builds or a half-applied graph — the existing serialization still holds, covered by a test
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented, tested, and measured — but the measurement contradicts this task's premise, so read the numbers before assuming the cold path is fixed. It is not. See TASK-12.13.

WHAT LANDED
- `GraphCache.warm()`: starts the build (persisted-cache load, else full build) and resolves once it has settled. Reuses the existing `settle()` so the persist drain completes too — after `warm()` resolves the on-disk cache reflects it, which is what makes a restart resume and what the integration test observes. Never rejects: build failures are absorbed by `ensureGraph` exactly as on the request path, and a failed fingerprint scan returns quietly for the next `lookup` to retry. Idempotent (joins an in-flight build; no-op once a graph exists) and deliberately does NOT reconcile an existing graph — that stays `lookup`'s job, where freshness is mandatory.
- `startServer` fires it un-awaited, with a `.catch` as defence in depth, and logs the settle duration for ops visibility.
- `ServerHandle.graphWarmup` exposes the promise so embedders can await readiness deliberately.

MEASURED (pos-module-mcp, real stdio bin, cache file removed for a true cold start, load ~2.7–4.2):
| scenario | first call | warm-up settled |
|---|---|---|
| no client gap | 65.0 s | 65.0 s |
| 10 s client gap | 51.0 s | 61.0 s |
| warm calls, either | 1.0–1.1 s | — |

So the warm-up buys ONLY the idle gap the client happens to leave (~14 s of 65 s here). The graph build is CPU-bound and Node is single-threaded: standalone it is 37 s, and when a lint overlaps it the two ADD (65 s) instead of interleaving. Starting the work earlier cannot fix contention — it only front-loads whatever time the client was not using. The pre-existing 46–58 s figure and this 65 s are not directly comparable (different load), which is precisely why both scenarios were measured in one window.

TESTS — every new test verified to FAIL without the implementation, not merely to pass with it:
- 6 unit tests in `graph-cache.spec.ts` (`warm()` block + a real-fixture hydrate-from-disk test). Sabotaging `warm()` to a no-op fails 6 of them; the 7th ("joins an in-flight build") correctly still passes, since `lookup` builds anyway.
- 2 integration tests in `stdio-smoke.spec.ts` asserting the property end to end: a client connects, calls NO tool, and the persisted graph file must still appear; and the FIRST `validate_code` must return `impact.status: computed` (asserted WITHOUT the polling helper, which would otherwise hide the very thing under test). Removing the `startServer` warm-up fails both.
- Suites: supervisor 87 (was 78), check-node 115, graph 109, check-common 1055; monorepo type-check and format clean.

INCIDENT WORTH KNOWING: 7 pre-existing `graph-cache.spec.ts` tests failed mid-work and looked like a regression. They were stale build artifacts — an earlier `yarn build` had run while checked out on `supervisor-check`, so the workspace dists (notably `platformos-graph`, which that spec imports) were built from graph-free sources. `yarn install --frozen-lockfile` + `yarn build` on this branch cleared all 7. After any branch switch between these two lines, rebuild before trusting a test result.
<!-- SECTION:FINAL_SUMMARY:END -->
