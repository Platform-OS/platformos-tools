---
id: TASK-70
title: Unify the duplicated AST walkers in platformos-check-common
status: Done
assignee: []
created_date: '2026-08-07 11:55'
updated_date: '2026-08-07 12:16'
labels:
  - cleanup
  - check-common
  - refactor
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`platformos-check-common` walks an AST in three places. Two of them are the same 30-line algorithm written twice.

## The duplication

`src/visitors/liquid.ts` (`visitLiquid`) and `src/visitors/json.ts` (`visitJSON`) are structurally identical: same explicit stack, same `lineage = ancestors.concat(node)`, same entry method, same reverse-order array push, same `:exit` method. They differ in exactly three things — the type-guard function's name, where the skip-set comes from (the parser's `nonTraversableProperties` vs a local `new Set(['loc'])`), and the static types.

`src/visitor.ts` holds a third traversal (`visit` + `forEachChildNodes`). It is NOT the same contract — it collects return values and supports neither `:exit` methods nor `onCodePathStart`/`onCodePathEnd` — so it should not be merged into the other two. But its child-enumeration half (`forEachChildNodes`) duplicates the same "array-or-node property" logic a third time.

## A latent hazard to fix while here, NOT a live bug

`forEachChildNodes` enumerates `Object.values(node)` with **no skip set**, while the parser declares `nonTraversableProperties` = `parentNode`, `prev`, `next`, `firstChild`, `lastChild` with the comment "Those properties create loops that would make walking infinite".

This was measured, not assumed: a probe over 3,957 node objects from 21 real project files plus a synthetic sample found **none** of those properties populated on the AST `toLiquidHtmlAST` produces. So `visit`/`findCurrentNode`/`findJSONNode` cannot cycle today. The exposure is a future one — an augmented AST (the prettier plugin does set `parentNode`) reaching this code would hang it. Passing the correct skip set closes that without changing any current behaviour.

## Scope

Extract ONE parameterized walker that `visitLiquid` and `visitJSON` both delegate to, and give the `visitor.ts` child enumeration the same skip-set treatment. Do not merge `visit` into the check-runner walkers — different contract, and collapsing them would give `visit` lifecycle hooks it has no callers for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The stack-walk algorithm shared by `visitLiquid` and `visitJSON` exists once; both are thin delegations that supply only their type guard, skip set and types
- [x] #2 `forEachChildNodes` skips the parser's `nonTraversableProperties` for Liquid nodes, so an augmented AST cannot make it loop
- [x] #3 `visit` keeps its current contract — collects return values, no `:exit`, no lifecycle hooks — and is not merged into the check-runner walker
- [x] #4 Traversal ORDER is unchanged for both Liquid and JSON/YAML: a test pins the exact visit sequence for a nested fixture, and it matches the sequence the current code produces
- [x] #5 Sabotage confirms the shared walker is load-bearing: removing the `:exit` dispatch, and separately the reverse-order array push, each makes tests fail
- [x] #6 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` pass across the monorepo
- [x] #7 Lint output over the four sample projects in ~/projects/pos is offense-for-offense identical to before, compared with the order-insensitive oracle (CLI output order is nondeterministic — a text diff is not a valid check)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Two things the refactor turned up that the plan did not anticipate

**1. `await check[type]?.(…)` is not equivalent to `if (method) await method(…)`.** The
optional-call form awaits `undefined` for every node a check has no method for — nearly
all of them — adding a microtask per node per check in the hot loop. It also REORDERED
results: the engine runs check pipelines concurrently, so extra ticks change which
finishes first, and `required-doc-param-with-default`'s spec failed with the same two
offenses in the opposite order. Same for `async function f() { return g() }` in the
`visitLiquid`/`visitJSON` wrappers, which now return the walk's promise directly. Both
are commented in place.

**2. The recorded traversal order is not what the code appears to promise** (see
TASK-73). Writing the characterization test by reasoning about the implementation would
have produced the wrong sequence — my first draft asserted post-subtree `:exit` and
document-order siblings, and BOTH halves were wrong. The passing test's sequences were
recorded from the running code via a throwaway `Proxy` recorder.

## Fixture weakness caught by sabotage

The first Liquid fixture was `<b>{{ x }}</b><i>{{ y }}</i>` — two structurally identical
elements. Reversing the array push order produced the identical TYPE sequence, so the
sabotage passed. Changed to `<b>{{ x }}</b>{% assign z = 1 %}` so the siblings differ and
order is observable. Sibling order is only testable when siblings are distinguishable.

## Sabotage results

- Remove the `:exit` dispatch -> both characterization tests fail.
- Push array items forwards instead of in reverse -> both characterization tests fail
  (after the fixture fix; only YAML before it), and **97 tests across 23 files** in the
  wider suite.

## Measurement behind the forEachChildNodes change

A probe over 3,957 node objects from 21 real project files found NONE of
`parentNode`/`prev`/`next`/`firstChild`/`lastChild` populated on the AST
`toLiquidHtmlAST` produces, so adding the skip set changes nothing today — it closes a
future hazard (the prettier plugin builds an augmented AST that does set them). The set
is imported from the parser rather than respelled; an earlier draft duplicated the five
names locally, which is the second-copy this repo forbids.

## Deliberately not done

`visit` in `visitor.ts` keeps its own contract — collects return values, no `:exit`, no
lifecycle hooks — and was not merged into `walkNodes`. Merging would hand it hooks no
caller wants and would couple a collecting walk to a check-runner walk.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted the stack walk shared by `visitLiquid` and `visitJSON` into one parameterized
`walkNodes` (`src/visitors/walk.ts`); each is now a thin delegation supplying only its
type guard, skip set and types. Gave `visitor.ts`'s `forEachChildNodes` the parser's
`nonTraversableProperties` so an augmented AST cannot make it loop. `visit` is unchanged.

Added `src/visitors/traversal-order.spec.ts`, a characterization test pinning the exact
entry/exit sequence for both a Liquid and a YAML AST — recorded from the running code,
not reasoned about. Traversal order is a contract here: checks accumulate state across
nodes, so a reordered walk changes offenses on some files.

**Two behaviour-preserving details that are easy to lose and are now commented:** the
walker must use `if (method) await method(…)` rather than `await check[type]?.(…)`, and
the wrappers must return the walk's promise rather than be `async` — both add microtask
ticks that reorder concurrently-running check pipelines, which a spec caught.

Corrected `CheckExitMethods`'s doc comment in `types.ts`: it claimed `:exit` happens "in
reverse order" when it actually fires immediately after entry, BEFORE the subtree. No
shipped check uses `:exit`, which is how the wrong prose survived. Behaviour left as-is
and tracked in **TASK-73**.

## Verification

- `yarn build` green; `yarn test` **360 files / 3854 tests, 0 failures**.
- Lint equivalence on all four sample projects via the order-insensitive oracle:
  11060 / 252 / 481 / 16761 offenses, all SAME.
- Sabotage: removing the `:exit` dispatch and reversing the array push order each fail
  the characterization tests; the latter also fails 97 tests across 23 files.
<!-- SECTION:FINAL_SUMMARY:END -->
