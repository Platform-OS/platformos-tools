---
id: TASK-71
title: >-
  Fold context-utils' private cached() into memo, and document why the other
  caches differ
status: Done
assignee: []
created_date: '2026-08-07 11:55'
updated_date: '2026-08-07 12:27'
labels:
  - cleanup
  - check-common
  - refactor
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dead-code audit reported "four memoization mechanisms" in `platformos-check-common`. Investigating each consumer shows that claim was **partly wrong**, and the correction matters more than the cleanup: three of the four are genuinely different tools and must stay.

## What the four actually are

| Helper | Shape | Call sites |
|---|---|---|
| `memo` (`utils/memo.ts`) | single value, no key | ~21 across check-common, docs-updater, LSP |
| `memoize` (`utils/memo.ts`) | keyed, `force`/`invalidate`/`clearCache` | 6 (graph, LSP) |
| `createBoundedCache` (`utils/bounded-cache.ts`) | keyed, LRU, hard cap | 2 (`extract-undefined-variables`, `graphql-schema`) |
| `cached` (`context-utils.ts`, private) | single promise | 1 |

Single-value, keyed-unbounded and keyed-LRU are three different jobs. Collapsing them would either give every call site an LRU it does not need or take the cap away from the two that do. **Only `cached` is redundant**: it is a worse `memo` — same single-value contract, a truthiness check (`!cachedPromise`) where `memo` uses an `Unset` sentinel, and no `clearCache`.

## Scope

Replace `cached` with `memo` and delete it. Then write the distinction down where the next reader will look, so "there are four caches here" does not get re-reported as duplication.

## One thing to look at but probably NOT change

`memoize` is unbounded and nothing clears it in production. The realistic exposure is `startServer`'s `findProjectRoot` and `loadConfig`, keyed by URI over a long-lived LSP session — one small string entry per file ever touched. Assess it; only act if the measurement justifies churn, and record the finding either way rather than leaving it implicit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `cached` is gone from `context-utils.ts` and its call site uses `memo`
- [x] #2 `memo`, `memoize` and `createBoundedCache` all still exist, and a comment in `utils/memo.ts` states what distinguishes the three so the difference is not re-reported as duplication
- [x] #3 The memoization is proven load-bearing rather than assumed: a test shows `getDefaultTranslations` reads the filesystem once across repeated calls, and it fails when the memo is removed
- [x] #4 `memoize`'s unbounded growth is assessed and the conclusion recorded in the task notes — changed only if a measurement justifies it, left alone with the reason stated otherwise
- [x] #5 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` pass across the monorepo
- [x] #6 Lint output over the four sample projects in ~/projects/pos is offense-for-offense identical, via the order-insensitive oracle
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC #4 — the `memoize` unboundedness assessment, and why nothing changed

Read every call site's key function rather than reasoning from the helper's shape. The
worry does not survive contact with them:

| Call site | Keyed by | Bound |
|---|---|---|
| `startServer.ts` `loadConfig` | **rootUri** (first arg), not the file | one entry per project root |
| `startServer.ts` `findProjectRoot` | file uri | one short string per file touched — **and explicitly cleared** at `startServer.ts:621-622` on a config change |
| `DocumentManager.preload` | rootUri | one per project root |
| `FilterCompletionProvider.options` | `PseudoType` | a small fixed set |
| `graph/augment.ts` `getSourceCode` | uri, but the memo is created **inside** `augmentDependencies(...)` | scoped to one graph build, collected with it |

`loadConfig` was the one I expected to be per-file and it is not. The single genuinely
per-file cache holds root strings and has an explicit `clearCache()` wired to the event
that invalidates it. **No change made** — bounding these would add an LRU where the key
space is already small or already cleared, which is churn against a non-problem.

## The original audit finding was partly wrong, and that is recorded in the code

"Four memoization mechanisms" implied duplication. Three of them are different tools:
unkeyed / keyed-unbounded / keyed-LRU. `createBoundedCache`'s two consumers key on file
CONTENT, so their key space really is unbounded and the cap is load-bearing; the
`memoize` consumers key on roots and files. The table now lives at the top of
`utils/memo.ts` so the next reader does not re-derive it — or re-report it.

## Sabotage

Replacing `cached(() => …)` with a bare `() => …` makes the new memoization test fail
with 3 filesystem reads instead of 1. The test counts reads through a wrapping
`AbstractFileSystem` and carries a control asserting the first call read something at
all, so "1 read" cannot be satisfied by a loader that reads nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted `cached` from `context-utils.ts` and pointed `makeGetDefaultTranslations` at
`memo`. `cached` was `memo` with two downgrades: a truthiness check (`!cachedPromise`)
where `memo` uses an `Unset` sentinel — so it would re-compute forever for a function
legitimately returning `undefined`/`null`/`0`/`false` — and no `clearCache`. It also
carried an overload signature that disagreed with its implementation signature, for a
call site that only ever used the zero-argument form.

Added a memoization test to `context-utils.spec.ts` that COUNTS filesystem reads through
a wrapping `AbstractFileSystem` (1 read across 3 calls), with a control asserting the
first call read something — a result-equality test would pass with no cache at all.

**Corrected the audit's own claim in the code.** "Four memoization mechanisms" implied
duplication; three are genuinely different tools. `utils/memo.ts` now opens with a table
of `memo` (unkeyed) / `memoize` (keyed, unbounded, explicit invalidation) /
`createBoundedCache` (keyed, LRU) saying what each is for and why collapsing any pair is
wrong — `createBoundedCache`'s consumers key on file CONTENT, so their key space really
is unbounded and the cap is load-bearing.

Assessed `memoize`'s unbounded growth and **deliberately changed nothing** — see Notes.
`loadConfig` turned out to be keyed by root rather than by file, and the one per-file
cache holds short strings and is explicitly cleared on config change.

## Verification

- `yarn build` green; `yarn test` **360 files / 3855 tests, 0 failures**.
- Lint equivalence on all four sample projects via the order-insensitive oracle:
  11060 / 252 / 481 / 16761 offenses, all SAME.
<!-- SECTION:FINAL_SUMMARY:END -->
