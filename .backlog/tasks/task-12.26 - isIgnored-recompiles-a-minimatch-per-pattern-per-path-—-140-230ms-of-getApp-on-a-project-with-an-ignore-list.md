---
id: TASK-12.26
title: >-
  isIgnored recompiles a minimatch per pattern per path — 140-230ms of getApp on
  a project with an ignore list
status: Done
assignee: []
created_date: '2026-08-01 09:46'
labels:
  - performance
  - check-common
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured while implementing TASK-12.22 (2026-08-01). With the glob pruned, this is
the single biggest remaining cost of `getApp` on a project that configures `ignore`.

`check-common/src/ignore.ts`:

```ts
export function isIgnored(uri, config, checkDef?) {
  const ignorePatterns = [...].map((pattern) => pattern.replace(...).replace(...).replace(...));
  return ignorePatterns.some((pattern) => minimatch(uri, pattern));
}
```

Both halves run per CALL, and `getAppFilePaths` calls it once per globbed path:
the pattern list is rebuilt (three regex replaces each) and `minimatch(uri, pattern)`
compiles a fresh `Minimatch` every time. Nothing is cached across calls or across paths.

`getApp` phase breakdown, warm, three runs each:

| project | candidate paths | walk | isIgnored | classify | getApp total |
|---|---|---|---|---|---|
| pos-module-community (ignores `modules/common-styling/**`) | 1558 | 34-64 ms | **140-232 ms** | 15-30 ms | 207-267 ms |
| arabbank (small ignore list) | 3236 | 56-67 ms | 19-25 ms | 43-52 ms | 130-169 ms |

## Fix

Compile once per config: build the rewritten pattern list and the `Minimatch`
instances lazily, memoized on the `Config` object (plus the `CheckDefinition` for the
per-check variant), and match against the compiled instances. Pure perf, no semantic
change — same patterns, same matcher, same answers.

Note `isIgnored` is also called per file per CHECK inside `check()`, so the win is not
only in `getApp`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 isIgnored compiles each ignore pattern at most once per config, pinned by a test that spies on the compilation
- [x] #2 getApp time on pos-module-community is measured against the 207-267 ms baseline recorded here
- [x] #3 The set of ignored files is unchanged on pos-module-community and arabbank, compared file by file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`check-common/src/ignore.ts` now compiles the rewritten pattern list into `Minimatch`
instances once per `(config, check)` pair, memoized in a `WeakMap` keyed on the
`Config` object (the check-less variant keys on a symbol, so it cannot collide with a
check code). `isIgnored` only matches. Same patterns, same matcher, same answers —
`minimatch(uri, p)` is `new Minimatch(p).match(uri)` for every pattern that survives
the rewrite (the `#` comment shortcut is unreachable, since the rewrite turns `#foo`
into `**/#foo` first).

The memo is per Config OBJECT, and `loadConfig` returns a new one per call, so a
long-lived process still compiles once per call — not once per path per call, which
was the actual cost.

### Measured, three warm runs, fresh Config per run

`isIgnored` phase is the same filter over the same candidate list, new vs old
implementation, back to back in one process:

| project | candidates | patterns | isIgnored new | isIgnored old | getApp |
|---|---|---|---|---|---|
| pos-module-community | 1511 | 13 | **14-16 ms** | 76-98 ms | **45-69 ms** (was 207-267) |
| arabbank | 3141 | 0 global | 3-4 ms | 14-21 ms | 63-65 ms |
| Accala-MP | 2789 | 0 global | 5-6 ms | 23-25 ms | 61-66 ms |

The candidate counts are lower than the numbers in the description (1558 / 3236)
because TASK-12.22's anchored walk landed in between; the old-vs-new columns above are
measured against the same list, so they are the honest delta.

### Equivalence

Every candidate path was evaluated with both implementations, globally and once per
configured check (37 checks on pos-module-community, 36 on arabbank, 6 on Accala-MP):
**0 disagreements** — 55 907, 113 076 and 19 523 comparisons respectively.
<!-- SECTION:NOTES:END -->
