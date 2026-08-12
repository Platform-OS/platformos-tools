---
id: TASK-73
title: >-
  :exit visitor methods fire before the subtree, not after — decide whether to
  fix the behaviour
status: Done
assignee: []
created_date: '2026-08-07 12:06'
updated_date: '2026-08-11 20:36'
labels:
  - check-common
  - api-design
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A check's `` `${NodeType}:exit` `` method does not do what its name or its (now-corrected) doc comment said.

## What actually happens

The check-runner walker dispatches, in ONE loop iteration: the entry method, then the node's children pushed onto the stack, then the exit method. The children are popped in *later* iterations. So `X:exit` runs while everything under `X` is still unvisited — it is a second entry callback, firing immediately after the first.

Recorded from the running code in `src/visitors/traversal-order.spec.ts`, where every `X:exit` sits directly beneath its own `X`:

```
Document
Document:exit
  LiquidTag
  LiquidTag:exit
    LiquidBranch
    LiquidBranch:exit
```

`CheckExitMethods` in `types.ts` claimed "Happens once per node, in reverse order", which is the opposite. That comment has been corrected to describe the real behaviour (TASK-70) — this task is about the behaviour itself.

## Why it went unnoticed, and why it is not urgent

**No shipped check declares an `:exit` method.** All 41 use entry methods and the `onCodePathStart`/`onCodePathEnd` lifecycle hooks. So there is no live defect: the feature is dormant, the types offer it, and the first check to use it would get semantics nobody expects.

`onCodePathEnd` is unaffected — the engine calls it after the whole walk resolves, so "after the file" genuinely means after the file.

## The decision

Three options, and the right one is not obvious:

1. **Make `:exit` post-subtree**, the semantics the name implies. Requires the walker to push a sentinel/second visit per node — a real cost in the hot loop for a feature with zero consumers.
2. **Rename it** to something honest (`:after-enter`?) so the API stops implying tree semantics.
3. **Remove `CheckExitMethods` entirely** until a check actually needs it, on the grounds that an unused API with surprising semantics is a trap. `visitor.ts`'s separate `visit` has no exit support at all, so nothing else depends on the concept.

Whichever is chosen, `traversal-order.spec.ts` pins the current sequence and must be updated in the same change, deliberately, rather than being allowed to fail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded among the three options with its reasoning, including the hot-loop cost if post-subtree semantics are chosen
- [x] #2 If the behaviour changes, `visitors/traversal-order.spec.ts` is updated in the same change and the new sequence is RECORDED from the running code, not hand-written
- [x] #3 If `:exit` is kept in any form, at least one test declares an `:exit` method and asserts when it fires relative to the subtree — the absence of such a test is what let the wrong contract survive
- [x] #4 `CheckExitMethods`'s doc comment matches the implementation whichever option is taken
- [x] #5 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` pass across the monorepo
- [x] #6 Lint output over the four sample projects in ~/projects/pos is offense-for-offense identical via the order-insensitive oracle (expected either way — no shipped check uses `:exit`; a difference means something unintended moved)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision: option 3 — REMOVE `CheckExitMethods`, and the walker's exit dispatch with it

The three options were priced before choosing, because AC #1 asks for the hot-loop cost of
post-subtree semantics and that number turned out to decide the whole thing. Measured over
80 060 real node visits (three large files from `arabbank` and `platformos-documentation`),
alternating paired passes, medians of nine rounds, 8–15% spread:

| walker | ns/node |
|---|---|
| today, with the exit lookup, no exits declared | 278 |
| **exit dispatch removed** | **210** |
| sentinel-based post-subtree, no exits declared | 307 |
| sentinel-based post-subtree, one exit declared | 305 |
| today, one exit declared | 323 |

So **option 1 costs ~10% more walk time than the broken hook it fixes**, and option 3 gives
back **33% of the walker's own time** — a template-string allocation plus a property lookup
per node per check, paid by all 41 shipped checks for a feature none of them used. Option 2
(rename) keeps that cost and keeps an API nobody wants.

Removal also matches how this repo has treated every other consumer-less seam (`fileSize`,
`getDefaultLocale`, `validateJSON`, `runJSONCheck`, `getReferences`, `singleFileOnly`). If a
check ever needs post-subtree semantics, re-adding it is the sentinel row above plus a test —
cheaper than fixing semantics someone has come to depend on.

## AC #6 — the corpus oracle, and it is the load-bearing evidence

Offenses **identical** on all four sample projects, with the exit dispatch on vs off, two
alternating rounds each: same sorted `check\turi\tstart\tend\tmessage` fingerprint AND the
same file manifest (diffed separately, so a file dropping out of coverage could not look like
a file that stopped offending).

| project | offenses | files | identical | CPU (median) |
|---|---|---|---|---|
| pos-module-community | 36 | 1507 | yes | 32.8 vs 35.6 s |
| htevent | 16 758 | 2895 | yes | 151.4 vs 156.6 s |
| Accala-MP | 252 | 2789 | yes | 20.2 vs 21.1 s |
| arabbank | 11 059 | 3139 | yes | 77.2 vs 79.7 s |

End-to-end CPU is 1–4% lower depending on estimator, the same direction in **seven of eight**
paired runs — consistent with a 33% saving on a walk that is a small share of a whole-project
lint, and not a claim worth sharpening further at this sample size.

## What landed

- `types.ts`: `CheckExitMethods` deleted; `Check<T>` is now
  `Partial<CheckNodeMethods & CheckLifecycleMethods>`, and the `Check<T>` example no longer
  shows an `:exit` method (AC #4 — the comment cannot disagree with an implementation that no
  longer exists).
- `visitors/walk.ts`: the exit lookup and dispatch removed; the docblock now states the ONE
  callback per node and where post-subtree work belongs (`onCodePathEnd`).
- `visitors/index.spec.ts`: both recorded sequences updated from the running code, not by
  hand (AC #2). The recorder is a `Proxy` that offers a method for every property asked of
  it — `` `${type}:exit` `` included — so these two tests are also the assertion that nothing
  but the entry method is ever dispatched. **Sabotage-verified: re-adding the two dispatch
  lines fails both.**
- `.changeset/no-per-node-exit-callback.md` (minor on check-common: a public type is gone).

`yarn build`, `yarn type-check` and `yarn format:check` clean; every package suite green
(check-common 1536, platformos-common 522, LSP 535, check-node 173, graph 130, supervisor 407,
parser 302, prettier plugin 144) (AC #5).

AC #3 does not apply — nothing keeps `:exit` in any form.

## One unrelated failure found while running the suite, and it is NOT from this change

`invalid-hash-assign-target/index.spec.ts` ('fills a type from the gap table ONLY where the
docset has no data at all') fails as soon as the docs-updater's `postbuild` refreshes
`data/filters.json`: the platformOS docs API now serves a filter the repo has never seen,
`falsy_argument_error`, with no `return_type`, so the sweep finds a hole the gap table does
not list. Reverting the re-downloaded `filters.json` makes it pass again. It needs a MEASURED
return type from a live instance, not an invented one — filed as TASK-78.
<!-- SECTION:NOTES:END -->
