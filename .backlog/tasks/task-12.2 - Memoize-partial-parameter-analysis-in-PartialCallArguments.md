---
id: TASK-12.2
title: Memoize partial parameter analysis in PartialCallArguments
status: Done
assignee: []
created_date: '2026-07-29 03:51'
updated_date: '2026-07-29 04:37'
labels:
  - performance
  - check-common
dependencies: []
modified_files:
  - packages/platformos-check-common/src/utils/bounded-cache.ts
  - packages/platformos-check-common/src/utils/bounded-cache.spec.ts
  - >-
    packages/platformos-check-common/src/checks/partial-call-arguments/extract-undefined-variables.ts
  - >-
    packages/platformos-check-common/src/checks/partial-call-arguments/extract-undefined-variables.cache.spec.ts
  - packages/platformos-check-common/src/checks/partial-call-arguments/index.ts
  - packages/platformos-check-common/src/index.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`PartialCallArguments` is the single most expensive check on a real project: 9703 ms of a 23869 ms all-checks run on pos-module-mcp.

For every `{% render %}` / `{% function %}` / `{% include %}` call site it resolves the target file, reads it, and calls `extractUndefinedVariables(source, globalObjectNames)` — which runs a full `toLiquidHtmlAST()` parse of the target (`checks/partial-call-arguments/extract-undefined-variables.ts:43`). There are ~499 call sites in this project, so a commonly-rendered helper is re-parsed once per caller, within a single lint run and again on every subsequent run.

`extractUndefinedVariables` is a pure function of `(source, globalObjectNames)`, and its result is tiny — two string arrays. Caching the *result* keyed on the target source (plus the global-object list identity) removes the repeated parse without retaining any ASTs, so it lowers peak memory rather than raising it. The docset-derived `globalObjectNames` list is also rebuilt per call site today and can be computed once.

Memory constraint: cache the `{ required, optional }` result only — never the AST or the source text as a value. Bound the number of entries so a huge project cannot grow it without limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A target partial's undefined-variable analysis is computed once per distinct source content, not once per call site
- [x] #2 The cached value contains only the analysis result; no AST or parsed node is retained
- [x] #3 The cache is bounded (documented limit) and correctly invalidates when a partial's content changes between lint runs
- [x] #4 The docset-derived global object name list is computed once per check run instead of per call site
- [x] #5 Offenses reported by PartialCallArguments are unchanged, verified by existing specs plus a test asserting a partial rendered from several call sites is analyzed once
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`extractUndefinedVariables` is now a memoizing wrapper around a private `computeUndefinedVariables`, keyed on `globalObjectNames` + NUL + source. Backed by a new `createBoundedCache(limit)` util (insertion-order eviction, `has`-based lookup so falsy results count as hits), capped at 512 entries.

Memory: only the `{ required, optional }` result is stored — no ASTs. Results are copied on the way out, so callers keep owning their arrays and one caller cannot corrupt another's (pinned by a test). Because the key is the exact content, an entry can never be stale — an edited partial is simply a different key.

Also hoisted the global-object-name derivation in `PartialCallArguments` from per-call-site to once per checked file via `memo`, and made the two duplicated copies of that loop one. The `app` special case for `views/partials/` / `/lib/` copies the shared list before extending it.

Verified with a parser spy: a source is parsed once no matter how many call sites ask, re-analyzed when content or the in-scope globals change.

Measured on pos-module-mcp: PartialCallArguments 9898 ms → negligible. Combined with TASK-12.1, whole-project `check()` 21284 ms → 7294 ms (dna-idea 4353 → 1912 ms, poetry-blog 33846 → 11030 ms) with byte-identical offenses on all three.
<!-- SECTION:FINAL_SUMMARY:END -->
