---
id: TASK-27
title: >-
  InvalidHashAssignTarget mis-types filter results, reporting a working array
  index-assign — a false block in a BLOCKING check
status: Done
assignee: []
created_date: '2026-08-01 11:54'
updated_date: '2026-08-01 22:48'
labels:
  - bug
  - check-common
  - correctness
  - false-block
dependencies: []
modified_files:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.spec.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`InvalidHashAssignTarget` tracks each variable's type locally so it can report `hash_assign` against a non-object. Its inference does not model FILTER RETURN TYPES: it types a variable from the filter's INPUT, so a value produced by a filter is recorded as whatever was piped in.

The visible consequence, measured against a live instance:

```
{% assign x = '' | split: ',' %}
{% hash_assign x[0] = 'value' %}
```

- runtime: **renders**, `["value"]` — an Array with a numeric index is valid
- check:   reports `Cannot use hash_assign on 'x' which is a string`

Both halves are wrong: `x` is an Array, not a string, and the operation is legal.

This matters more than a normal precision bug because `InvalidHashAssignTarget` is in the MCP supervisor's `BLOCKING_CHECKS` set, so the offense sets `must_fix_before_write: true` and refuses working code.

## Measured behaviour, for whoever fixes this

`hash_assign` accepts Hash OR Array; the constraint is that an Array needs an INDEX and a Hash needs a KEY. Verified on `fk-docs.ps-01-platformos.com`:

| buffer | runtime | check today |
|---|---|---|
| `{% assign x = 5 %}` + `x['key']` | raises `HashAssignTagError` | reports (number) — correct |
| `{% assign x = 'str' %}` + `x['key']` | raises | reports (string) — correct |
| `{% assign x = true %}` + `x['key']` | raises | reports (boolean) — correct |
| `{% assign x = (1..3) %}` + `x['key']` | raises | reports (array) — correct outcome |
| `parse_json` array + `x[0]` | **renders** | silent — correct |
| `parse_json` object + `x['key']` | **renders** | silent — correct |
| `'' \| split: ','` + `x[0]` | **renders** | **reports (string) — WRONG** |
| `'' \| split: ','` + `x['key']` | raises (`expected index, key was provided`) | reports (string) — right outcome, wrong reason |

So the core of the check is sound and worth keeping; only filter-produced values are mistyped.

## Direction

The docset already carries a `return_type` per filter, and checks receive `context.platformosDocset`, so the return type of a filtered assignment is available without inventing a new data source. Note the docset is known to be incomplete (TASK-20): filters absent from it, and the six generated undocumented ones, have no `return_type` at all — an unknown return type must therefore be treated as UNKNOWN and reported as nothing, never guessed.

Consider also distinguishing the two Array cases the runtime distinguishes: index-assign is valid, key-assign is not. Reporting `x['key']` on an Array with the runtime's own reason would be more useful than the current "can only be used on object types", which is not what the runtime enforces.

## Out of scope

Do not resolve this by removing the check from the supervisor's blocking set. It models a real runtime failure for the number/string/boolean cases, all confirmed to raise; de-blocking it would trade one false block for several false approvals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% assign x = '' | split: ',' %}{% hash_assign x[0] = 'v' %}` produces no offense
- [x] #2 A variable assigned from a filter whose docset `return_type` is an object still reports correctly when `hash_assign` is used on a non-object
- [x] #3 A filter with NO return type information in the docset yields no offense rather than a guessed type — unknown must not become a report
- [x] #4 The number, string, boolean and range cases continue to report, so the fix does not trade a false block for false approvals
- [x] #5 Array with a numeric index is accepted and array with a string key is still reported, matching what the runtime actually enforces
- [x] #6 Offense messages describe the real constraint (Hash needs a key, Array needs an index) rather than "can only be used on object types"
- [x] #7 Every case in the measured table in the description is covered by a test asserting whole offense values
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two defects, and they compounded — which is why the symptom looked like one bug.

1. FILTER RETURN TYPES NOW COME FROM THE DOCSET. The four hand-written filter-name arrays are gone. They were wrong in the way hand-written tables are: `split` appeared in BOTH the string list and the array list, the string branch ran first, and so a filter-produced Array was typed `string`. `context.platformosDocset.filters()` carries `return_type` for 166 of the 167 shipped filters, so the data already existed. Built once per file and memoized, because `filters()` is async.

2. THE SUBSCRIPT IS NOW READ. The check ignored it entirely, which is why it described the rule as "can only be used on object types" — not what the runtime enforces. `accessorOf()` reads the first lookup on the target: a `String` node is a key, a `Number` node is an index, anything else (`x[y]`) is `unknown`. The decision table now matches the measured runtime: primitives and ranges always report; an Array reports only for a key; a Hash and anything unknown never report.

`DOCSET_RETURN_TYPES` is an EXACT-MATCH table of five spellings. The docset carries twelve distinct ones including `time`, `date`, `datetime`, `'string, nil'`, `'array of arrays'` and an empty string; resemblance-matching those would be guessing, and a wrong guess in a BLOCKING check refuses working code. Anything unrecognised is `untyped` and produces nothing — a missed detection, which is the only direction that cannot manufacture a false block. A filter declaring several return types resolves only when every branch maps to the same thing.

Two smaller corrections fell out:

- `range` is no longer folded into `array`. Measured, `(1..3)` + `x['key']` raises; `(1..3)` + `x[0]` was never measured. Folding it in would have forced a guess either way — approve an unmeasured range index-assign, or refuse a measured-working Array index-assign. It gets its own type and reports on any subscript, which is exactly today's behaviour for ranges.
- After a `hash_assign`, an Array now stays an Array. It used to be recorded as `object` unconditionally, which silenced a key-assign on the very next line. `hash_assign` writes INTO an array; it does not convert it.

VERIFIED THROUGH THE REAL SUPERVISOR, against the PRODUCTION docset rather than the spec's mock — which matters, because the whole fix depends on real `filters.json` data being shaped the way the mock assumes:

```
split + x[0]   (was a FALSE BLOCK)  block=false  IHAT=(none)
split + x['k'] (raises)            block=true   IHAT=Cannot use hash_assign on 'x' with a string key, because ...
number + x['k'](raises)            block=true   IHAT=Cannot use hash_assign on 'x', which is a number. ...
parse_json + x['k'] (renders)      block=false  IHAT=(none)
unknown filter                     block=true   IHAT=(none)   <- UnknownFilter fires; this check stays quiet
```

Every row of the measured table in the description now matches the runtime.

SABOTAGE-VERIFIED, four ways, each hitting a different property:

| Sabotage | Fails |
|---|---|
| ignore the subscript (report for any Array) | 3 — incl. the headline false block |
| resemble-match unknown return types instead of refusing them | 1 — the unknown-type case |
| let `hash_assign` convert an Array to an object | 1 — the later key-assign |
| fold `range` back into `array` | 3 |

No sabotage failed everything, which is the useful signal: each property is pinned by its own case rather than by one broad test that would have passed for the wrong reason.

TESTS. Ten new cases in a dedicated describe block, whole-value assertions including exact spans, driven through `runLiquidCheck` with a docset mirroring the real `filters.json` shapes — including `new_line_to_br`, the one filter that genuinely ships with no `return_type` at all. Also covered: the last filter in a chain decides; an unreadable subscript stays silent; the check degrades to silence rather than switching off when no docset is available (it keeps working on unfiltered assignments, which are the majority).

ONE PRE-EXISTING TEST CHANGED MEANING, deliberately: 'hash_assign on an array (range)' asserted the message contained 'array'. A range is no longer called an array, so it now asserts 'range'. The assertion was not weakened to accommodate the change — the type genuinely became more specific, and the comment on that test says why.

STALE PROSE CORRECTED in three places that all described the old behaviour: the check's own `meta.docs.description` ('not an object type (e.g. number, string, boolean, array)'), the justification comment in the supervisor's `BLOCKING_CHECKS`, and the note in `blocking.spec.ts` that recorded this as a known outstanding false block.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`InvalidHashAssignTarget` refused working code: `{% assign x = '' | split: ',' %}{% hash_assign x[0] = 'v' %}` renders fine and was reported as a hash_assign on a string. Since the check is in the supervisor's `BLOCKING_CHECKS`, that was a blocking refusal — the worst-shaped defect in the gate.

Two causes, fixed together. Filter return types came from four hand-written arrays in which `split` appeared in both the string list and the array list, string first; they are replaced by the docset's own `return_type`, which covers 166 of 167 shipped filters. And the check ignored the subscript entirely, so it could not express the rule the runtime actually enforces — a Hash takes a key, an Array takes an index. It now reads the subscript and reports only what the runtime rejects, with messages naming the real constraint instead of "can only be used on object types".

Unknown stays unknown throughout: an unrecognised return-type spelling, a filter absent from the docset, an unreadable subscript, or no docset at all all produce nothing. That costs a missed detection and is the only direction that cannot manufacture another false block.

Verified against the production docset through the real supervisor, and sabotage-verified four ways, each hitting a distinct property.
<!-- SECTION:FINAL_SUMMARY:END -->
