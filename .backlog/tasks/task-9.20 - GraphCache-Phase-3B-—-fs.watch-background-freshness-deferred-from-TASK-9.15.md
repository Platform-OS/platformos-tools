---
id: TASK-9.20
title: GraphCache Phase 3B — fs.watch background freshness (deferred from TASK-9.15)
status: To Do
assignee: []
created_date: '2026-07-03 07:37'
labels:
  - mcp-supervisor
  - performance
  - architecture
dependencies:
  - TASK-9.15
references:
  - packages/platformos-mcp-supervisor/src/graph-cache/graph-cache.ts
  - SUPERVISOR-GRAPH-INTEGRATION.md
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-9.15 (Phase 3B), which shipped Phases 1 (incremental apply), 2 (persistence), and 3A (scoped walk). This is the remaining Phase 3B: keep the graph fresh in the BACKGROUND via `fs.watch` (incremental apply on watch events) so the request path performs NO per-call fingerprint scan on the steady state.

MANDATORY: the fingerprint reconciliation MUST remain as the safety net for missed/unsupported watch events (recursive-watch gaps on Linux, inotify limits, editor atomic-save renames, network FS, macOS FSEvents quirks) — NEVER trust the watcher alone. Watch = speed; fingerprint = truth.

DEFERRED BY DECISION (record the rationale): on the actual `validate_code` path the fingerprint scan (~391ms on marketplace-dcra) runs CONCURRENTLY with lint's multi-second whole-project parse (`Promise.all` in runValidateCode), so it adds ≈0 wall-clock today. fs.watch would optimize a cost that is NOT on the critical path, at the price of real platform-specific watcher complexity + lifecycle (setup/teardown/debounce/missed-event handling). Recommendation: implement ONLY if profiling ever shows the steady-state scan on the critical path (e.g. blast-radius consumed outside the lint-concurrent path, or many concurrent calls serializing scans). Otherwise this can stay closed as won't-do-now.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 fs.watch keeps the graph fresh in the background (incremental apply on events) so the steady-state request path performs no per-call full fingerprint scan
- [ ] #2 The fingerprint reconciliation remains the safety net for missed/unsupported watch events — the watcher is never trusted alone; never-stale preserved
- [ ] #3 Watcher lifecycle is clean (setup on first use, torn down on shutdown; debounced; bounded)
- [ ] #4 TDD: watch-event → incremental apply, and missed-event → fingerprint-reconciliation fallback; supervisor suite + type-check + format green
- [ ] #5 Docs: SUPERVISOR-GRAPH-INTEGRATION.md §10 updated to the final incremental+persisted+WATCHED architecture (fingerprint-authoritative)
<!-- AC:END -->
