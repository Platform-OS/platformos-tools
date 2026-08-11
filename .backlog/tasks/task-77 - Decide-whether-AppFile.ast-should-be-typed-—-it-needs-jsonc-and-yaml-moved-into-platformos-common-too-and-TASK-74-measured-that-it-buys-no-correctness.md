---
id: TASK-77
title: >-
  Decide whether AppFile.ast should be typed — it needs jsonc and yaml moved
  into platformos-common too, and TASK-74 measured that it buys no correctness
status: To Do
assignee: []
created_date: '2026-08-11 20:29'
labels:
  - architecture
  - platformos-common
  - api-design
  - research
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Where this comes from

TASK-74 (doc-1) researched making `platformos-common` own project state and concluded MOVE IN
PART. One question was deliberately left out of it and is this task: **should `AppFile.ast` be
typed instead of `unknown`?**

What that research established, so it is not re-derived:

- Taking `@platformos/liquid-html-parser` into `platformos-common` is cheap and safe —
  measured **+881 B on the vscode web bundle (+0.010 %)**, no CPU change, offense multiset
  identical, and no dependency cycle (`liquid-html-parser` has no workspace deps of its own).
  The spike was built and then REVERTED, because cheap is not the same as worth doing.
- It buys **no correctness**. `AppFile.derived` already carries analyses this package cannot
  name, with `ast: unknown` — `undefinedVariablesOf` is the worked proof. Every consumer that
  needs the concrete type already guards with `isLiquidDocument(...)`, which is a two-line
  narrowing, not a workaround.
- It is **not a one-package move**: `JSONNode` (YAML *and* JSON both parse into it) lives in
  `platformos-check-common`, so typing `ast` properly means moving jsonc and yaml down as
  well. Typing only the Liquid arm leaves the union half-typed, which is worse than `unknown`
  because it reads as complete.
- `app/package-boundaries.spec.ts` now records the rationale that survives:
  **`ast: unknown` is not a limitation being worked around — it is the evidence that the
  design does not need the parser.** Whoever opens that dependency list has to replace that
  sentence with a better one.

## What the decision is actually about

Ergonomics, not capability: how many `isLiquidDocument` / `isJSONNode` guards the toolchain
carries, against `platformos-common` growing three parser dependencies and stopping being the
package that sits below the ASTs. The honest options are (1) leave it, (2) move all three
parsers down and type `ast` as the union, (3) type it through a generic on the CONSUMER side
without moving anything.

Do not reopen it as "add liquid-html-parser and see" — that spike is done and its numbers are
in doc-1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every consumer that narrows an `AppFile.ast` today is listed with the guard it uses, so the ergonomic cost being traded is counted rather than asserted
- [ ] #2 A decision is recorded among leave-as-is / move all three parsers down / type on the consumer side, with the reason
- [ ] #3 If anything moves: the vscode web extension and CodeMirror playground still build and the bundle delta is recorded; whole-project offenses are multiset-identical on the ~/projects/pos corpus via the sorted oracle
- [ ] #4 If anything moves: `app/package-boundaries.spec.ts`'s dependency list AND its stated rationale are updated together — its current rationale is that `ast: unknown` is the evidence the design does not need the parser
- [ ] #5 The half-typed outcome is explicitly ruled in or out: typing the Liquid arm while `JSONNode` stays in check-common is either the decision or is rejected in writing
<!-- AC:END -->
