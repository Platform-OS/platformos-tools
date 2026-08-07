---
id: TASK-73
title: >-
  :exit visitor methods fire before the subtree, not after — decide whether to
  fix the behaviour
status: To Do
assignee: []
created_date: '2026-08-07 12:06'
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
- [ ] #1 A decision is recorded among the three options with its reasoning, including the hot-loop cost if post-subtree semantics are chosen
- [ ] #2 If the behaviour changes, `visitors/traversal-order.spec.ts` is updated in the same change and the new sequence is RECORDED from the running code, not hand-written
- [ ] #3 If `:exit` is kept in any form, at least one test declares an `:exit` method and asserts when it fires relative to the subtree — the absence of such a test is what let the wrong contract survive
- [ ] #4 `CheckExitMethods`'s doc comment matches the implementation whichever option is taken
- [ ] #5 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` pass across the monorepo
- [ ] #6 Lint output over the four sample projects in ~/projects/pos is offense-for-offense identical via the order-insensitive oracle (expected either way — no shipped check uses `:exit`; a difference means something unintended moved)
<!-- AC:END -->
