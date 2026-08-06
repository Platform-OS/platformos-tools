---
id: TASK-65
title: >-
  InvalidHashAssignTarget is blind to a {% function %} subscript target — the
  write semantics are unmeasured, not decided
status: To Do
assignee: []
created_date: '2026-08-06 10:39'
labels:
  - check
  - measurement
  - blocking-check
  - hash_assign
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/subscript-writes.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidHashAssignTargetSyntax.ts
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`hash_assign` is deprecated. Both `{% assign h['k'] = v %}` and `{% function h['k'] = 'partial' %}` write into a Hash on current platformOS.

`InvalidHashAssignTarget` was extended to cover `assign` (subscript writes and the `<<` append), because every container × subscript combination was measured against `/api/app_builder/liquid_exec` with the container read back afterwards. `function` was NOT extended, and this task records exactly why, so the gap is not mistaken for an oversight and not closed by inference.

## What IS measured about `{% function %}`

All eight target spellings — `h['k']`, `h["k"]`, `h.a['b']`, `h[k]`, `h[0]`, `h.k`, `h.a.b`, `h['a'].b` — reach PARTIAL RESOLUTION rather than a syntax error. Each returned `Liquid error: can't find partial "…"`, never a `Liquid syntax error`. A parse error preempts rendering, so this establishes that the target parses in every notation.

That is enough for `InvalidHashAssignTargetSyntax` (a parse-time rule, correctly left `hash_assign`-only) and NOT enough for `InvalidHashAssignTarget` (a runtime type rule).

## What is NOT measured

Whether `{% function h['k'] = 'p' %}` where `h` is a String raises `"h is …, expected Hash or Array"` the way `assign` and `hash_assign` both do.

Settling it needs a partial that EXISTS on the oracle instance, and `fk-docs.ps-01-platformos.com` has none reachable — seven plausible paths were tried (`lib/queries/get`, `modules/core/lib/queries/get`, `lib/helpers/render`, `lib/commands/create`, `app/lib/noop`, `lib/noop`, `shared/noop`) and all answered `can't find partial`. The partial error fires BEFORE the assignment, so no probe against a missing partial can reach the setter.

## Current behaviour, and why it is the safe reading

The `function` branch rebinds the target variable to `untyped` whether or not the target has lookups, exactly as before. Nothing is reported for a `function` target. `InvalidHashAssignTarget` is in `BLOCKING_CHECKS` at severity `error`, so reporting on an inference would be a false block — the most expensive mistake this check can make. A missed detection is the mild end of the ranking.

Pinned by `subscript-writes.spec.ts` → "says nothing about a function target, whose write semantics are unmeasured", which is paired with an `assign` control on the identical buffer so the silence cannot go vacuous.

## How to close it

Deploy one partial that returns a known value, then run the container × subscript matrix for `function` exactly as `hashwrite2.mjs` ran it for `assign`/`hash_assign`.

If `function` matches, the fix is small: route its subscript targets through the same `subscriptWriteMessage` call and `narrowAfterWriteInto` that `assign` uses. If it does NOT match, the current silence is already correct and only the comments need updating.

Secondary, and cheap once an instance is writable: `{% function h['k'] = 'p' %}` may turn out to DROP the write silently, the way `{% capture h['k'] %}`, `{% parse_json h['k'] %}` and `{% increment h['k'] %}` were measured to (rendered, hash unchanged). Those three are protected today only because the grammar refuses a subscript there and `InvalidTagSyntax` reports the unparsed markup — worth confirming that is actually what an author sees.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A partial that exists is available on an oracle instance, and the container x subscript matrix (Hash/Array/String/Number/Boolean/nil/unset x key/index/dot) is run for {% function %} with the container read back after the write, so acceptance means the write happened
- [ ] #2 The result is recorded in the task, stating for each row whether it matches the measured assign/hash_assign behaviour
- [ ] #3 If function matches: its subscript targets go through subscriptWriteMessage and narrowAfterWriteInto, with the same paired report/control tests as assign, and the deliberate-silence test in subscript-writes.spec.ts is replaced rather than deleted
- [ ] #4 If function does not match: the comments in InvalidHashAssignTarget and InvalidHashAssignTargetSyntax are corrected to state the measured reason for the silence, since a documented silence whose justification is wrong propagates further than a bug
- [ ] #5 Sabotage confirms the new tests bite: neutering the function branch fails them, and the assign control still passes
<!-- AC:END -->
