---
id: TASK-27
title: >-
  InvalidHashAssignTarget mis-types filter results, reporting a working array
  index-assign — a false block in a BLOCKING check
status: To Do
assignee: []
created_date: '2026-08-01 11:54'
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
- [ ] #1 `{% assign x = '' | split: ',' %}{% hash_assign x[0] = 'v' %}` produces no offense
- [ ] #2 A variable assigned from a filter whose docset `return_type` is an object still reports correctly when `hash_assign` is used on a non-object
- [ ] #3 A filter with NO return type information in the docset yields no offense rather than a guessed type — unknown must not become a report
- [ ] #4 The number, string, boolean and range cases continue to report, so the fix does not trade a false block for false approvals
- [ ] #5 Array with a numeric index is accepted and array with a string key is still reported, matching what the runtime actually enforces
- [ ] #6 Offense messages describe the real constraint (Hash needs a key, Array needs an index) rather than "can only be used on object types"
- [ ] #7 Every case in the measured table in the description is covered by a test asserting whole offense values
<!-- AC:END -->
