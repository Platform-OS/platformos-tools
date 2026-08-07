---
id: TASK-12.15
title: >-
  Eliminate the double parse: one process-wide parsed-source cache shared by the
  graph build and the lint
status: Done
assignee: []
created_date: '2026-07-29 23:22'
updated_date: '2026-08-07 12:51'
labels:
  - performance
  - check-node
  - platformos-graph
dependencies: []
parent_task_id: TASK-12
priority: high
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The same files are parsed twice per process by two independent code paths:

- the graph build traverses and parses ~808 liquid files (36–49 s), and
- `getApp` parses the 162-file app set for the lint (10.9 s cold),

with a large overlap and no sharing. Both use `toLiquidHtmlAST`, i.e. the same 20–35 KB/s parser.

Both halves of the key already exist on this branch: `fileFingerprint` (`mtimeMs:ctimeMs:size`, hardened in TASK-12.4) and `AppCache` (`reuse`/`store`/`prune`). What is missing is that platformos-graph's traversal knows nothing about them, so it cannot reuse a parse the lint already paid for — or vice versa.

Roughly a free 2x on the cold path, independent of the grammar work in TASK-12.14 and composing with it (a faster parser makes each miss cheaper; a shared cache removes the misses).

Two things to establish first, because they change the design:
- **Count parses versus distinct files during one build.** If traversal re-parses a module on each visit rather than once, the multiplier is worse than 2x and that is a separate bug to fix before caching hides it.
- **Decide where the cache lives.** It cannot be check-node's `AppCache` as-is: platformos-graph is consumed by the browser/LSP too, and the graph build now runs on a WORKER THREAD (TASK-12.13) with its own heap — a main-thread cache is invisible to it. Either the parse cache moves to a shared, runtime-neutral home that both can hold, or the worker returns its parses alongside the graph so the main thread can seed its cache from them.

The worker boundary is the subtle part: naive sharing would silently do nothing now that the build is off-thread.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Parses per build are counted against distinct files first, and any re-parse-per-visit multiplier is reported before the cache is designed
- [ ] #2 A file's AST is produced at most once per process per (uri, fingerprint) across BOTH the graph build and the lint — asserted with a parser spy, not inferred from timings
- [ ] #3 The worker-thread boundary is handled explicitly: either the cache is reachable from both heaps or the worker's parses are transferred back, with the chosen approach documented
- [ ] #4 Cold graph build time and cold lint time on pos-module-mcp measured before/after and recorded separately
- [ ] #5 Peak RSS measured before/after — sharing parses must not simply move the memory cost (currently ~1050 MB peak with the worker)
- [ ] #6 Offense output byte-identical on three real projects; graph dependents unchanged (existing GraphCache and app-cache specs pass untouched)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS SUPERSEDED 2026-08-07 — the premise was rejected, the goal was met

The goal — stop parsing the same file twice per process — was achieved. The MECHANISM
this task specifies was explicitly considered and rejected.

`platformos-common/CLAUDE.md` states it: "**A parsed-source cache keyed on
`(uri, fingerprint)` is not the way to share parses here — sharing the file OBJECTS
is.**" The lazy-`App` model (TASK-46 epic, archived) made `App`/`AppFile` the single
answer to "the project's files, parsed", replacing four separate mechanisms including
the fingerprint cache this task builds on. The graph now reads through
`appBackedGetSourceCode(app, fallback)` (`platformos-graph/src/parsers.ts`), so a graph
build and a check run in one process hold the same `AppFile`s and parse once.

**Both primitives this task depends on are gone.** `AppCache` and `fileFingerprint` no
longer exist in `platformos-check-node/src` — the only surviving mentions are historical
comments in the supervisor's `graph-cache-store.ts`. So the task cannot be executed as
written, and the work it wanted is already done.
<!-- SECTION:NOTES:END -->
