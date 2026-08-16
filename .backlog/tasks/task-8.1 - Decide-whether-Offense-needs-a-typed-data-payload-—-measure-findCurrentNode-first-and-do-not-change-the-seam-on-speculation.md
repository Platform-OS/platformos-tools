---
id: TASK-8.1
title: >-
  Decide whether Offense needs a typed data payload — measure findCurrentNode
  first, and do not change the seam on speculation
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
updated_date: '2026-08-16 12:05'
labels: []
dependencies:
  - TASK-7.7
references:
  - packages/platformos-check-common/src/types.ts
  - packages/platformos-check-common/src/checks
parent_task_id: TASK-8
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Re-scoped 2026-08-16 — this may not need doing at all

The task assumed the supervisor must regex-parse `message` to recover a matched identifier
unless `Offense` gains a typed `data` payload. That assumption has a third answer nobody
checked: **`findCurrentNode(ast, offset)` is exported by `platformos-check-common`** and is
what the language server's hover, definition, highlight and linked-editing providers all
use to resolve the node at a position. Enrichment holds both the AST and the offense range,
so it can resolve the symbol structurally — no message parsing, no seam change, no new
dependency.

The original justification is also gone: it was needed so the rule library could "pick hint
variants and render `{{var}}` substitutions". Hint variants and `{{var}}` prose are
forbidden by TASK-7's invariant 6 and TASK-8.3 has been dissolved. What remains needing an
identifier is narrower: rendering the docset entry for the filter/tag/object a diagnostic is
about (TASK-7.7).

## So this task is now a decision, not an implementation

Extending `Offense` is a check-common change with cross-package blast radius — editors, the
CLI and the browser build all consume it. That is worth paying for a demonstrated need and
not for a hypothetical one.

**Step 1 — measure.** With TASK-7.7's enrichment in place, run `findCurrentNode` at the
offense range for every check the supervisor enriches, over the real projects in
`~/projects/pos`. Record, per check, how often it resolves to the node carrying the
identifier, and what it resolves to when it does not.

**Step 2 — decide on the numbers.** If resolution is reliable, close this task as "not
needed" and record the measurement so the question is not reopened from first principles.
If specific checks mis-resolve — plausibly ones whose offense range spans a whole tag rather
than the identifier inside it — extend the seam for THOSE checks only.

**Step 3, only if warranted.** Add an optional, typed, runtime-agnostic `data` field to the
`Offense`/`Problem` contract, thread it through `context.report`, and populate it in the
checks the measurement named — not in a speculative list of eleven. Additive only; existing
consumers must compile and pass untouched.

## Non-negotiable either way

No regex over a diagnostic `message` in any consumer, under any outcome. That is TASK-7
invariant 2 and it is guarded. If `findCurrentNode` cannot answer and the seam is not
extended, enrichment emits nothing for that diagnostic — an absent hint is honest, a parsed
one is not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A per-check measurement over the real projects in ~/projects/pos records how reliably findCurrentNode resolves the identifier at each offense range, and the numbers are committed
- [ ] #2 The decision is recorded either way: 'seam change not needed' with the evidence, or a named list of checks that require it and why
- [ ] #3 If the seam is extended, the data field is optional, typed, runtime-agnostic and additive; the browser build and the existing editor/CLI consumers compile and pass unchanged
- [ ] #4 If the seam is extended, only the checks the measurement named populate it, each pinned by a check-common unit spec
- [ ] #5 No consumer reads the diagnostic message string to recover an identifier under any outcome
<!-- AC:END -->
