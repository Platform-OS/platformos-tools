---
id: TASK-66
title: >-
  A space before the subscript bracket is a FALSE APPROVAL — `{% assign h ['k']
  = v %}` parses here and is a parse error on the platform
status: Done
assignee: []
created_date: '2026-08-06 11:23'
updated_date: '2026-08-18 12:43'
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

---

## Round 7 measurements (2026-08-17) — the blast radius is bounded, and the scope is WIDER than filed

The "bound the blast radius before changing anything" instruction above has been carried out. Every
row below is paired against the identical construct without the space, on instance
`fk-docs.ps-01-platformos.com`, tools at `f455e95c`. Full write-up:
`supervisor-tests/auto-eval/reports/whitespace-in-assignment-targets.md`.

### 1. READ positions accept it — so the change MUST be scoped to targets only

Six read positions render the correct value and are correctly approved today. Narrowing the shared
`lookup<delim>` rule would turn all six into false blocks:

```
{{ h ['k'] }}                -> 1     {% assign v = h ['k'] %}   -> v == 1
{{ h.a [0] }}                -> 7     {% if h ['k'] %}           -> branch taken
{{ h[ 'k' ] }}               -> 1     {% echo h ['k'] %}         -> 1
```

AC #1 is satisfied by this measurement.

### 2. It is the DOT accessor too, not just the bracket

The platform's `LHS_PATTERN` (`app/lib/liquify/tags/hash_assignable.rb`) is
`(VARIABLE_NAME)(MIXED_KEYS_PATTERN)?` with `MIXED_KEYS_PATTERN = '(?:\.[\w\-]+|\[.+?\])+'`. There is
no `\s*` between the name and the key path, and the alternation covers `.foo` as well as `[…]`:

```
{% assign h .k  = 9 %}   RAISED + converter REJECTS      {% assign h.k = 9 %}   assigns
{% assign h . k = 9 %}   RAISED + converter REJECTS
```

So the rule to encode is **no whitespace between a variable name and the start of its key path**, not
"no space before a subscript".

### 3. `{% function %}` is affected, with a DIFFERENT error message

`hash_assignable.rb` states the LHS building blocks are shared "in both Assign and FunctionTag":

```
{% function r ['k'] = 'lib/…' %}   RAISED  Liquid syntax error: Invalid syntax for function tag
{% function r['k']  = 'lib/…' %}   parses (fails later only for want of the partial)
```

### 4. The `<<` append operator is affected too

```
{% assign a ['z'] << 'x' %}   RAISED     {% assign a['z'] << 'x' %}   appends
```

### 5. Severity is higher than filed: a CONVERTER REJECTION, not just a runtime raise

`pos-cli deploy --dry-run`, 2/2 repeats each, every space-free control ACCEPTED:

| buffer | converter |
|---|---|
| `{% assign h ['k'] = 9 %}` | REJECTED |
| `{% hash_assign h ['k'] = 9 %}` | REJECTED |
| `{% liquid hash_assign h ['k'] = 9 %}` | REJECTED |
| `{% assign h .k = 9 %}` | REJECTED |
| `{% liquid assign h .k = 9 %}` | REJECTED |
| `{% assign h . k = 9 %}` | REJECTED |

The task inferred whole-changeset impact; it is now measured.

### Consequence for the fix

The strict rule must cover **three tags** (`assign`, `hash_assign`, `function`), **both operators**
(`=` and `<<`), **both accessors** (`[…]` and `.`), and the `{% liquid %}` block form — and must not
touch the shared read path. Regression fixtures for all thirteen measured spellings live in
`supervisor-tests/auto-eval/suites/02-tags.mjs`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The leading-space spelling is measured in READ positions as well as write targets, so the grammar change can be scoped without guessing
- [x] #2 The grammar refuses `name [` only where the platform does, and a fixture covers both the refused and the accepted spacings (`h['k' ]`, `h[ 'k']`)
- [ ] #3 A check reports the construct with a message naming the actual remedy (remove the space before the bracket), not the bracket-subscript remedy, which the author has already satisfied
- [x] #4 The supervisor returns must_fix_before_write true for it, asserted end to end in blocking-emission.spec.ts, with the accepted spacings asserted silent in blocking-silence.spec.ts
- [x] #5 prettier-plugin-liquid round-trips every accepted spelling unchanged, and the pinned invariant in liquid-tag-assign/index.spec.ts still holds
- [x] #6 The placeholder test in InvalidHashAssignTargetSyntax.spec.ts ('stays silent on a target the platform refuses for a reason that is not notation') is replaced by the real assertion rather than deleted
- [x] #7 The strict target rule covers all three write tags (assign, hash_assign, function), both operators (= and <<), both accessors ([...] and .), and the {% liquid %} block form
- [x] #8 Read positions are provably untouched: {{ h ['k'] }}, {{ h.a [0] }}, {{ h[ 'k' ] }}, assign RHS, if condition and echo all still parse
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure READ vs WRITE positions on the instance to scope the change (done — reads accept the space, writes reject it).
2. Add target-only grammar rules (lookupStart, strictDotLookup, targetLookup, strictVariableLookup); leave lookup/liquidVariableLookup untouched for reads.
3. Point assignTarget, liquidTagHashAssignMarkup and liquidTagFunctionMarkup at them.
4. Add the two passthrough stage-1 mappings.
5. Pin every spelling in assign-target-spacing.spec.ts; migrate the stale x [ 'k' ] fixture and the InvalidHashAssignTargetSyntax placeholder; assert the printer emits refused markup verbatim; assert the gate verdict end to end.
6. Verify on the instance and the converter, then re-run pos-cli check over a real 2 768-file app to prove no new offense.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch fix-whitespace-in-assignment-targets.

GRAMMAR (liquid-html.ohm): added `lookupStart`, `strictDotLookup`, `targetLookup`, `strictVariableLookup`; `assignTarget` and the hash_assign/function markups now use them. The read path (`lookup`/`liquidVariableLookup`) is untouched. stage-1-cst gained two passthrough mappings; stage 2, the printer and the language server needed no change because the AST shape is unchanged.

VERIFIED against the instance, every spelling paired with its space-free control: 34 of 35 cases now agree with the platform (12 refused, 22 accepted). Full suite 4204 passed / 342 files, type-check, build and format:check all clean. On a real 2 768-file application, pos-cli check reports 13 225 offenses in 2 002 files — IDENTICAL to before the change, LiquidHTMLSyntaxError still exactly 122, so no new offense on production code.

AC#3 is PARTIALLY met and left unchecked: the construct is reported by InvalidTagSyntax as \"Invalid syntax for tag 'hash_assign' Expected syntax: {% hash_assign variable['key'] = value %}\", which shows the correct form but does not name the space. A targeted message needs a new detector and is deliberately out of this change.

TWO GAPS RECORDED RATHER THAN HIDDEN:
1. `{% assign h.a ['b'] = 9 %}` — a spaced bracket AFTER a dot — is still accepted and the platform refuses it. Closing it needs a recursive chain that would replace the flat `lookups` iteration the stage-1 mapping indexes. Pinned as a known gap in assign-target-spacing.spec.ts. Residual false approval, pre-existing, not a regression.
2. TASK-80 filed: inside a {% liquid %} body, a statement with raw markup is unreported for `assign`/`echo` while hash_assign/function/log are reported. PROVEN pre-existing by rebuilding the pre-fix parser.
<!-- SECTION:NOTES:END -->
