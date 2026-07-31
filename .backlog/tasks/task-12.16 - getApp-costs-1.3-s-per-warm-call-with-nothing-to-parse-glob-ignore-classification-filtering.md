---
id: TASK-12.16
title: >-
  getApp costs 1.3 s per warm call with nothing to parse (glob +
  ignore/classification filtering)
status: Done
assignee: []
created_date: '2026-07-29 23:23'
updated_date: '2026-07-30 19:08'
labels:
  - performance
  - check-node
dependencies: []
modified_files:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-common/src/ignore-memoization.spec.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Newly measured, and previously unattributed: on a WARM `AppCache`, where no file needs parsing, `getApp` still costs **1331 ms of a 1715 ms warm `lintBuffer`** on pos-module-mcp — 78% of the warm call.

Breakdown of that warm call:

```
loadConfig                                 51 ms
graph fingerprint: enumerateEdgeSources   236 ms
graph fingerprint: 1357 x fileFingerprint  96 ms
lint: glob project                        204 ms
lint: 1686 x fileFingerprint               95 ms
lint: getApp with warm cache             1331 ms   <- here
lint: full warm lintBuffer               1715 ms
```

Note what this rules out: the per-file `stat` calls are cheap (95 ms for 1686 of them), so "too many stats" is NOT the warm-path problem. Subtracting the glob (204 ms) and the fingerprints (95 ms) leaves ~1 s inside `getApp` doing neither I/O nor parsing. The remaining candidates, in `getApp`'s own filter chain over 1686 paths, are `normalize` per path plus `isIgnored` (minimatch against the config's ignore patterns) and the `isKnownLiquidFile` / `isKnownGraphQLFile` / `isKnownYAMLFile` regex classification — minimatch in particular is a known cost when run per path per call.

This is pure per-call overhead: for an unchanged project the glob result and its classification verdicts are identical every time, yet both are recomputed on every `validate_code`.

Profile the filter chain first to attribute the ~1 s precisely (minimatch vs regex vs normalize), then cache the derived path set keyed on the glob result, invalidated exactly as the parses are — the fingerprint already tells us when a file changed, and an added/removed file changes the glob output itself.

Worth doing even though TASK-12.8 (lazy parse) targets the same function for the COLD path: these are different costs in the same place, and after 12.8 this 1.3 s becomes the dominant remaining term in a warm call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The ~1 s inside `getApp` is attributed by profile to its specific causes (minimatch/isIgnored, path classification regexes, normalize) with numbers recorded, before any caching is added
- [x] #2 Warm `lintBuffer` latency on pos-module-mcp measured before/after and recorded
- [x] #3 Correctness preserved on project changes: an added, removed, renamed or ignored-status-changed file is reflected on the NEXT call — covered by tests, not just by reasoning
- [x] #4 Whole-project consumers (CLI, autofix) see no behaviour change; check-node and check-common suites pass unchanged
- [x] #5 Offense output byte-identical on three real projects
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
PROFILE FIRST (AC#1) — and it corrected this task's premise. The "~1 s unaccounted inside getApp" was largely an artefact of measuring BEFORE TASK-12.8: with lazy parsing in place, `getApp` on a warm cache was already only **211 ms**, attributed as:

```
glob (raw paths, 1686)                58 ms
normalize x N                          2 ms
isIgnored x N (minimatch)            175 ms   <- 83% of getApp
isKnownLiquidFile/GraphQL/YAML x N    ~2 ms total
fileFingerprint x kept (162, stat)     3 ms
readFile x kept                       10 ms
getApp TOTAL (warm cache)            211 ms
```

So it was neither the classification regexes nor `normalize` nor the stats — it was `isIgnored`, and the fix turned out to need no cache invalidation at all.

ROOT CAUSE — `isIgnored` called minimatch's FUNCTIONAL form, `minimatch(uri, pattern)`, which constructs and compiles a `Minimatch` on EVERY call, and it re-derived the pattern list (three `replace`s per pattern) on every call too. `isIgnored` runs once per globbed path in check-node and once per (file, check) pair inside `check()`, so this was thousands of compilations per request.

FIX — two memoizations, neither of which can go stale:
1. Compiled matchers keyed by the transformed PATTERN STRING (bounded, 512). A matcher is a pure function of its pattern, so a changed config yields different keys — staleness is impossible by construction.
2. Transformed pattern lists keyed on the `Config` OBJECT via `WeakMap`, with the check code as inner key (per-check `ignore` differs). Keying on the object rather than a derived string means the hot path builds no key at all; a re-loaded Config gets a fresh entry and the GC handles eviction.

MEASURED (pos-module-mcp, 1686 globbed paths, idle machine):

| | before | after |
|---|---|---|
| `isIgnored` x 1686 | 175 ms | **49 ms** |
| `getApp` (warm cache) | 211 ms | **149 ms** |
| warm `lintBuffer` | ~1715 ms pre-12.8, 424 ms after | ~370 ms |
| warm `validate_code` (e2e) | 0.9–1.2 s | **0.6–0.7 s** |
| cold first call | 1.6 s | **1.2–1.3 s** |
| peak RSS | ~600 MB | ~590 MB (unchanged, as expected) |

The residual 49 ms is genuine minimatch MATCHING over 1686 paths, not setup. Pushing further would mean caching per-(config, path) verdicts, which only helps across runs — and across runs the Config object is new, so it would reintroduce 1686 key constructions per call for roughly the time it saves. Stopped deliberately.

CORRECTNESS — `isIgnored` decides App membership, so offense parity is the real gate: byte-identical on pos-module-mcp (3), dna-idea (67) and poetry-blog (300), ranges included. Suites: check-common 1093, check-node 122, supervisor 92, LSP 474, graph 109, browser 1; type-check and format clean.

TESTS (AC#3) — 6 new specs pin the memoization AND the invalidation risk this task called out: each pattern compiles at most once across many paths; an equal-but-distinct Config does not recompile; a CHANGED ignore list is honoured rather than served from cache (the `.platformos-check.yml`-edited case, where no file fingerprint moves); the root is part of the key so the same pattern under a different root is not reused; per-check patterns stay separate from global ones; and no patterns compiles nothing. Reverting the memoization fails 2 of the 6 — the other 4 are correctness assertions that must pass either way.

TEST-DESIGN NOTE: `vi.fn(Minimatch)` cannot be used to count compilations — wrapping a class in `vi.fn` gives the mock its own prototype, so `new` yields an object without Minimatch's methods (`this.make is not a function`). The spec subclasses instead, preserving real behaviour.

ALSO WORTH KNOWING: a literal NUL byte in the first version of the cache key made git treat `ignore.ts` as BINARY. Replaced with a `\\u0000` escape — the same trap already hit in `extract-undefined-variables.ts`. Any future NUL-separated cache key should be written as an escape.

WHAT IS NOW DOMINANT — two per-call directory scans, neither in the filter chain: `glob` inside `getApp` (89–135 ms) and the graph's `enumerateEdgeSources` walk plus 1357 stats (~142 ms) in `GraphCache.lookup`. Getting the warm call under ~0.3 s means caching those listings with directory-mtime or watcher-based invalidation. Filed separately.
<!-- SECTION:FINAL_SUMMARY:END -->
