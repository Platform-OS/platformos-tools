---
id: TASK-64
title: >-
  check-node's process-level caches hold ONE project in a single slot — a second
  root silently evicts the first instead of being keyed or refused
status: To Do
assignee: []
created_date: '2026-08-05 21:20'
labels:
  - check-node
  - caching
  - architecture
  - measured
dependencies: []
priority: medium
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The question that prompted this, answered first

**"What happens when someone runs two instances of Claude with the supervisor connected?"**

**Nothing bad — they are separate OS processes.** Verified: the supervisor is stdio-ONLY
(`StdioServerTransport`, the sole transport in the package), and the bin calls `startServer`
exactly once with one `--project`. An MCP stdio client SPAWNS the server as a child process,
so two Claude instances mean two `node` processes, each with its own module-level state,
isolated by the OS. Nothing is shared and nothing thrashes.

The only cost is duplication: each process holds its own `App` (RSS ~278-341 MB peak measured
on real projects, `MAX_RETAINED_FILES = 200` capping retained sources) and its own graph cache
— though the on-disk graph cache file IS shared, keyed by a hash of the project root, and is
written atomically (temp + rename), so concurrent processes cannot observe a partial write.

So this task is NOT about that scenario. It is about the shape that made the question
reasonable to ask.

## The actual finding

`getSharedApp` and `getSharedRouteTable` each keep a SINGLE module-level slot, not a map:

```ts
let shared: SharedApp | undefined;              // shared-app.ts:15
let shared: SharedRouteTable | undefined;       // route-table.ts:16
let sharedDocsManager: … | undefined;           // index.ts:172
```

and the lookup discards on any root change:

```ts
if (shared?.rootUri !== rootUri) {
  const app = App.fromPaths(rootUri, paths, NodeFileSystem, parsers);
  shared = { rootUri, app, fingerprints: new Map() };   // previous project dropped
  return app;
}
```

Two roots alternating in ONE process therefore evict each other on every call. Results stay
CORRECT — the cache is rebuilt, not corrupted — so the only symptom is that every call is a
cold start, which is precisely the cost the lazy `App` model exists to remove (15.3 s → 0.27 s
on a 3138-file project). It is silent: no warning, no log, nothing distinguishes it from a
cache that is simply always missing.

Reached through `getApp(config)` → `lintBuffers`, `check`, `appCheckRun`, `checkAndAutofix`,
`backfill-docs`.

## Who is actually exposed

- **The supervisor: NOT exposed.** One process, one root, `rootUri` never changes.
- **The CLI: not in normal use.** One invocation, one root.
- **The test suite: exposed, and harmlessly.** Vitest runs many temp projects in one process,
  so the app is rebuilt constantly. Correctness-neutral, and partly why the suite is slow.
- **Any future embedder linting two projects in one process: exposed.** This is the real
  target — the shape is a trap for a caller that has no reason to expect it.

## The asymmetry worth noting

The language server already solved this: `DocumentManager` holds
`private readonly apps = new Map<UriString, App>()` (DocumentManager.ts:74) and is genuinely
multi-root. check-node implements the same "one app per project" idea with one slot. Two
packages, one concept, two answers — and only one of them survives a second root.

## Options, with the trade

1. **Key by root** — `Map<UriString, SharedApp>` with a small LRU (2-3 roots). Matches the LSP.
   Cost: unbounded-ish memory unless capped, and each retained root holds up to
   `MAX_RETAINED_FILES` sources.
2. **Fail loudly on a root switch** — throw or warn once. Cheapest, and makes the constraint
   visible instead of silently expensive. Wrong if multi-root is a legitimate use.
3. **Document the single-root contract and keep the behaviour** — valid only if we assert
   nothing should ever do this, which the test suite already contradicts.

Preference: (1) with an explicit cap, because it removes a silent performance cliff rather
than documenting one, and because the LSP has already shown the shape works. But the choice
should be measured, not assumed — see AC #1.

## Also: fix the misleading docstring

`SupervisorContext` is documented as "Per-server context threaded into every handler", which
reads as isolation. The context genuinely IS per-server; the caches it implies are not. Two
`startServer` calls in one process would get two contexts and SHARE one app. Whatever this
task decides, that comment should stop implying a sandbox.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Measured first: a benchmark alternating two real project roots in one process, showing the current per-call cost versus a single-root baseline — so the fix is justified by a number rather than by the shape looking wrong
- [ ] #2 A decision recorded between keying, failing loudly, and documenting the constraint, with the memory cost of the chosen option stated (each retained root holds up to MAX_RETAINED_FILES sources)
- [ ] #3 If keyed: a cap on retained roots, and a test that alternating roots does NOT rebuild — asserted by counting walks/parses, not by timing, so it cannot pass flakily
- [ ] #4 A test that the eviction path is still correct whichever option lands: after switching away from a root and back, an edit made in between is seen (no stale App served from a resurrected entry)
- [ ] #5 `getSharedRouteTable` and `sharedDocsManager` get the same treatment or an explicit written reason why they differ — three single-slot caches with one shared assumption must not diverge
- [ ] #6 The `SupervisorContext` docstring no longer implies per-instance isolation of the underlying caches
- [ ] #7 check-node's CLAUDE.md 'Process-level state' section states the single-root-or-keyed contract explicitly, since that is where the next person will look
<!-- AC:END -->
