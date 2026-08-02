---
id: TASK-12.19
title: >-
  Stop re-globbing the project on every validate_code call (the glob is now 90%
  of the cost)
status: Done
assignee: []
created_date: '2026-07-31 18:13'
labels:
  - performance
  - check-node
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-12.6, `validate_code`'s warm cost on a 3138-file project is 251 ms, and
**226 ms of it is `glob()`** walking the project tree inside `getApp`. Everything the
lazy App model was about — reads and parses — is now ~25 ms: 6 liquid parses, 10
`readFile`, 389 `stat` (the route-table fingerprints).

So the remaining work is per-call path DISCOVERY, not per-call parsing.

## Two candidate fixes

1. **Reuse one `App` per project per process** instead of building a fresh one per
   call, driving `App.update(uris)` / `App.remove(uris)` from a file watcher (or from a
   cheap directory-mtime check). The model already supports incremental re-indexing and
   already holds loaded sources, so this also stops re-reading render targets on every
   call. This is the same shape as the process-level `RouteTable` in TASK-12.6.7 — and
   the route table's own reconciliation could then be driven from `App.update` rather
   than from a per-call stat sweep.
2. **Cache the glob result** keyed by root, invalidated by a watcher or a TTL. Cheaper
   to build, but leaves the per-call `App` construction and the route-table stat sweep
   in place, so it wins less.

(1) is the intended direction — it is what the App model was designed to make possible
— but it needs a decision about what invalidates it in a long-lived process that does
NOT get filesystem events (the MCP supervisor's client may edit files out of band).
TASK-12.6.7 established the pattern and the reasoning about a long-lived process
pinning stale state.

## Watch for

- The 389 stats are ~20 ms, so do not replace one sweep with another. If the App is
  reused, the route table should be updated from `App.update` rather than re-stat-ing
  every page.
- Whatever invalidation is chosen must keep TASK-12.6.7 AC #3 true: a page added,
  changed or deleted on disk is still reflected without a full rebuild.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An approach is chosen between App reuse and glob caching with the rationale recorded, including what invalidates it in a process that gets no filesystem events
- [x] #2 Warm validate_code latency is measured and recorded after the change, alongside the 251 ms / 226 ms-of-glob baseline from TASK-12.6
- [x] #3 A file added, changed or deleted on disk between two calls is still reflected in diagnostics, pinned by a test
- [x] #4 Diagnostics remain identical to a per-call rebuild over a real multi-hundred-file project
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### The decision: App reuse (1), and NO caching of the walk

`check-node/src/shared-app.ts` holds one `App` per project per process, the same
shape as the `RouteTable` in TASK-12.6.7. `getApp` now walks, reconciles and returns
that app instead of building a new one.

**The walk is deliberately not cached.** Option (2) was rejected on the grounds the
description raises: the MCP supervisor's client edits files out of band and the
process gets no filesystem events, so a cached path list has no honest invalidator —
only a TTL, which trades "an agent's newly created partial is invisible for N
seconds" for a few tens of milliseconds. Re-walking is the invalidation mechanism,
not a cost the reuse failed to remove; what reuse removes is everything the walk does
NOT tell you: classifying every path, rebuilding both indexes, and re-reading the
files the previous call had already read.

The premise moved between the description and the work: TASK-12.22 anchored the walk
to the app subtrees, so the glob is no longer 226 ms of a 251 ms call. On arabbank
the walk is ~35 ms of a ~180 ms per-call rebuild, and `getApp` now costs
approximately the walk and nothing else (measured: `getAppFilePaths` 79-96 ms vs
`getApp` 85-95 ms on the same loaded machine — reconciliation does not register).

Reconciliation, per call, in `getSharedApp`:

| what changed | detected by | cost |
|---|---|---|
| file added / deleted | the walk, which every call does anyway | set difference over strings |
| file edited | `stat` per file whose source is IN MEMORY | ≤ the retained set, ~2-10 stats in practice |
| unsaved buffer | left alone by both rules | — |

Two things this forced:

- **`lintBuffer` reverts its overlay in a `finally`.** The app outlives the call now,
  so one request's unsaved content must not become the next request's truth. A file
  that exists on disk goes back to reading from it; one that does not yet exist leaves
  the app.
- **Fingerprints are taken BEFORE the read** (in a `NodeFileSystem` wrapper), so a
  write that lands between the `stat` and the read is caught by the next call rather
  than swallowed. Revalidation can re-read a file that did not need it; it cannot
  trust one that did.

Compare URIs as strings here. `App.has()` per path re-parses every URI in the project
through `vscode-uri` on every call — 20-40 ms on arabbank, most of what the reuse was
saving.

### Retention is capped

An app that lives as long as the process would otherwise accumulate every file
anyone ever linted. Measured over 300 sequential `lintBuffer` calls on arabbank:
450 files retained, RSS 242 → 574 MB, against 227 → 462 MB for the same calls with
the app rebuilt each time. `MAX_RETAINED_FILES = 200`, evicted by first-read order,
caps it: the same 300 calls plateau at 200 retained files and 497 MB. A single-file
lint loads under 10 files, so the cap is twenty-odd calls of working set deep.

### Measured, warm, interleaved shared/rebuilt on the same file

| project | files | warm `lintBuffer`, shared app | rebuilt per call |
|---|---|---|---|
| arabbank | 3139 | **104-116 ms** | 177-195 ms |
| Accala-MP | 2789 | **77-107 ms** | 123-160 ms |
| pos-module-community | 946 | **120 ms** | 136 ms |

(Medians of 10 interleaved pairs. The machine had other work on it; the arms were
interleaved so drift hits both equally. pos-module-community gains least because
classifying 946 paths is the smallest thing being skipped.)

Against the TASK-12.6 baseline of 251 ms with 226 ms of glob: the glob is now ~35 ms
(TASK-12.22) and the rebuild it fed is gone. Phase split of a warm call on arabbank:
`loadConfig` 5-14 ms, `getApp` (walk + reconcile) 58-73 ms, checks 26-47 ms.

### Equivalence

40 files per project, linted first through one shared app kept across the whole pass
(each file twice, so the second round is where a stale app would answer from the
first), then again with the app AND route table rebuilt before every call: **0
mismatches** on arabbank (109 offenses), Accala-MP and pos-module-community.

`src/shared-app.spec.ts` pins the rest: a partial added, deleted or changed between
two calls, a buffer not leaking into the next call, a buffer-only file not surviving
it, and the retention cap. Removing the revalidation step makes the "changed" test
fail (verified).

### Follow-ups

`getApp` is now the walk, so the walk is the next thing to attack — a hand-rolled
`readdir` walk measured 23-32 ms against glob's 34-39 ms on arabbank. TASK-12.23 (the
route table's per-call page sweep) is the other half of what a warm call still spends.
<!-- SECTION:NOTES:END -->
