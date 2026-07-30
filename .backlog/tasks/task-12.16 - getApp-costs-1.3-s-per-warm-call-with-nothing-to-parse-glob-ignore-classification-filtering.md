---
id: TASK-12.16
title: >-
  getApp costs 1.3 s per warm call with nothing to parse (glob +
  ignore/classification filtering)
status: To Do
assignee: []
created_date: '2026-07-29 23:23'
labels:
  - performance
  - check-node
dependencies: []
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
- [ ] #1 The ~1 s inside `getApp` is attributed by profile to its specific causes (minimatch/isIgnored, path classification regexes, normalize) with numbers recorded, before any caching is added
- [ ] #2 Warm `lintBuffer` latency on pos-module-mcp measured before/after and recorded
- [ ] #3 Correctness preserved on project changes: an added, removed, renamed or ignored-status-changed file is reflected on the NEXT call — covered by tests, not just by reasoning
- [ ] #4 Whole-project consumers (CLI, autofix) see no behaviour change; check-node and check-common suites pass unchanged
- [ ] #5 Offense output byte-identical on three real projects
<!-- AC:END -->
