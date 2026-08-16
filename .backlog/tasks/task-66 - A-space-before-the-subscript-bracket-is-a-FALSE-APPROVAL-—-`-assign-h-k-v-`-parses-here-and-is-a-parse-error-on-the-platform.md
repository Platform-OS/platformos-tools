---
id: TASK-66
title: >-
  A space before the subscript bracket is a FALSE APPROVAL — `{% assign h ['k']
  = v %}` parses here and is a parse error on the platform
status: To Do
assignee: []
created_date: '2026-08-06 11:23'
labels:
  - grammar
  - false-approval
  - measurement
  - blocking-check
dependencies: []
references:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidHashAssignTargetSyntax.spec.ts
  - packages/prettier-plugin-liquid/src/test/liquid-tag-assign/index.spec.ts
priority: medium
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

`{% assign h ['k'] = 'V' %}` and `{% hash_assign h ['k'] = 'V' %}` — a space between the variable name and the opening `[` — are accepted by `liquid-html-parser` and **rejected by the platform at PARSE time**.

Measured on `/api/app_builder/liquid_exec`, with a hash seeded and read back:

```
{% hash_assign h [ 'k' ] = 'V' %}   RAISED  Liquid syntax error: Syntax Error in 'hash_assign' - Valid syntax: hash_assign hash[key] = value
{% assign      h [ 'k' ] = 'V' %}   RAISED  Liquid syntax error: Syntax Error in 'assign' - Valid syntax: assign [var] = [value]
{% assign      h ['k']   = 'V' %}   RAISED  Liquid syntax error: Syntax Error in 'assign' - Valid syntax: assign [var] = [value]

{% hash_assign h['k']    = 'V' %}   assigns
{% assign      h['k' ]   = 'V' %}   assigns
{% assign      h[ 'k']   = 'V' %}   assigns
```

So the rule is narrow and easy to state: a space INSIDE the brackets is fine, a space BEFORE the `[` is not. The two were conflated.

Nothing in the toolchain reports it. `InvalidHashAssignTargetSyntax` answers a different question (the target must END in a bracket, which this target does), and `InvalidWriteTarget` answers a type question. Both are correctly silent. The grammar's `lookup<delim>` permits the leading space, so the markup parses and no check objects.

That makes it a **false approval**: the MCP supervisor returns `status: ok, must_fix_before_write: false` for a construct the deploy converter rejects — and a converter rejection fails the WHOLE changeset, taking every other file in the deploy with it. Same class as the `{% layout %}` defect.

## How it was found

While verifying that the prettier printer's OUTPUT is behaviour-preserving after the `assign`-target fix. The round-trip probe flagged `{% assign h [ 'k' ] = 'V' %}` as the one input whose formatted output did not agree with it — because the input raises and the output renders. The printer accidentally REPAIRS this today (it re-emits the target as `h['k']`), which is a happy accident and must not be relied on: an author who never formats keeps the broken file.

It also revealed a wrong measurement already committed: `InvalidHashAssignTargetSyntax.spec.ts` listed `h [ 'k' ]` under `PLATFORM_ACCEPTS` ("Measured to ASSIGN"). That has been corrected in place, with the true outcome recorded and a test pinning the current silence so the gap is visible rather than implicit.

## Fix

A grammar change, so all five layers move together per `CLAUDE.md`:

1. `lookup<delim>` (or a dedicated target rule) must not admit `space* "["` after a `variableSegment` in a WRITE-TARGET position. Note the same spelling is legal in a READ (`{{ h ['k'] }}` — needs its own measurement before narrowing anything shared).
2. `stage-1-cst.ts` / `stage-2-ast.ts` if a rule is added rather than tightened.
3. The printer must keep emitting `h['k']`, i.e. the repair becomes deliberate rather than incidental.
4. A check has to report it, otherwise a tolerant parse just moves the silence. Most likely `InvalidTagSyntax` via raw markup, which is already the mechanism for an unparseable known tag — confirm that is what an author actually sees rather than assuming.

## Bound the blast radius before changing anything

Measure whether the leading space is refused in READ positions too (`{{ h ['k'] }}`, `{% if h ['k'] %}`, filter arguments). If reads accept it, the grammar change must be scoped to targets only, or it becomes a false BLOCK — worse than the false approval it fixes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The leading-space spelling is measured in READ positions as well as write targets, so the grammar change can be scoped without guessing
- [ ] #2 The grammar refuses `name [` only where the platform does, and a fixture covers both the refused and the accepted spacings (`h['k' ]`, `h[ 'k']`)
- [ ] #3 A check reports the construct with a message naming the actual remedy (remove the space before the bracket), not the bracket-subscript remedy, which the author has already satisfied
- [ ] #4 The supervisor returns must_fix_before_write true for it, asserted end to end in blocking-emission.spec.ts, with the accepted spacings asserted silent in blocking-silence.spec.ts
- [ ] #5 prettier-plugin-liquid round-trips every accepted spelling unchanged, and the pinned invariant in liquid-tag-assign/index.spec.ts still holds
- [ ] #6 The placeholder test in InvalidHashAssignTargetSyntax.spec.ts ('stays silent on a target the platform refuses for a reason that is not notation') is replaced by the real assertion rather than deleted
<!-- AC:END -->
