---
id: TASK-37
title: >-
  Narrow the untyped docset return types for hash_assign, and fill the two
  docset holes
status: Done
assignee: []
created_date: '2026-08-02 07:10'
updated_date: '2026-08-02 13:58'
labels:
  - check-common
  - docset
  - detection-gap
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.spec.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-oracle.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-sweep.spec.ts
  - packages/platformos-check-common/scripts/verify-filter-return-types.mjs
  - packages/platformos-check-common/tsconfig.build.json
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`InvalidHashAssignTarget` maps six docset `return_type` spellings to `untyped` and reports nothing for them. That conservatism is deliberate, documented, and the correct default — a wrong type here is a false block, which is the expensive direction.

The finding is that the runtime evidence to narrow it now exists and is unambiguous. Each of these raises at runtime, and the raise message names the real type:

| Filter | Docset return_type | Runtime message | Safe mapping |
|---|---|---|---|
| to_date | date | x is 2026-01-01, expected Hash or Array | scalar |
| to_time | datetime | x is 2026-01-01 12:00:00 UTC, expected Hash or Array | scalar |
| parse_csv | array of arrays | x is an Array, expected index, k was provided | array |
| array_index_of | (empty string) | x is 0, expected Hash or Array | docset defect |
| new_line_to_br | (absent) | x is a, expected Hash or Array | docset defect |

## Owner split

`date`, `datetime`, `time` and `array of arrays` are a mapping decision in `DOCSET_RETURN_TYPES` in check-common. `array_index_of` (empty `return_type`) and `new_line_to_br` (no `return_type` at all) are docset DATA defects — the docset carries return types for 166 of 167 filters and these are the holes. Fixing them in the mapping table would be patching over a data problem.

## Two smaller gaps measured alongside

- `x[0]['k']` where `x` is an Array: the runtime raises, the check reads only the first lookup and stays silent. Bounded and known.
- `hash_assign` on a variable never assigned in the file: the runtime raises on null, the check treats unknown as untyped. This one is DEFENSIBLE BY DESIGN — in a partial, the variable may legitimately arrive as a render argument, so silence is the safe reading. Recorded here so it is not "fixed" by accident.

## Oracle

`liquid_exec`. These are runtime raises, not converter rejections; the converter accepts every one of these buffers.

## Falsifier

A filter documented `date` or `datetime` whose value legitimately accepts `hash_assign`. That would prove the conservative mapping is load-bearing rather than merely cautious, and this task should be closed rather than implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The date, datetime, time and array-of-arrays return-type spellings resolve to a modelled type, and a hash_assign onto a variable produced by a filter of each is reported with the correct remedy
- [x] #2 Each mapping change is justified by a recorded runtime observation, not by the spelling looking scalar-like
- [x] #3 The two docset entries with a missing or empty return_type are either corrected upstream or handled with the gap named at the call site as a data defect rather than a modelling choice
- [x] #4 No new false block: the negative-space corpus from TASK-34 passes unchanged, and the TASK-36 sweep is re-run if it has landed
- [x] #5 The x[0][key] case is either handled or explicitly recorded as out of scope at the call site, since only the first subscript is currently modelled
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

Four spellings narrowed, two docset holes handled at the call site. The falsifier this task named — a `date`- or `datetime`-typed value that legitimately accepts `hash_assign` — was looked for across the whole population and **not found**, so the conservative mapping was cautious rather than load-bearing and the narrowing stands.

## Measurements (oracle: `liquid_exec`)

| spelling | filters | runtime | key | index | mapped to |
|---|---|---|---|---|---|
| `date` | to_date, date_add, add_to_date | `Date` | raises | raises | `date` |
| `datetime` | to_time | `Time` | raises | raises | `time` |
| `time` | add_to_time | `Time` | raises | raises | `time` |
| `array of arrays` | parse_csv, parse_csv_rc | `Array` | raises | **renders** | `array` |
| `''` | array_index_of | `Integer` | raises | raises | `number` (gap) |
| absent | new_line_to_br, nl2br | `String` | raises | raises | `string` (gap) |

`datetime` and `time` collapse onto one modelled type because the runtime returns a `Time` for both — a measurement, not a decision to treat two spellings alike.

`array of arrays` gets the **Array** remedy, not the Hash one. `parse_csv[0]` renders, so reporting it would be a false block, and telling an author to convert it to a Hash would be wrong advice on a correct buffer.

A probe defect was caught first: `date_add`/`add_to_time` reject singular units (`'day'`, `'hour'`) with "third argument must be valid unit". The first draft used those, rendered nothing, and would have made all three rows uninterpretable. Units are plural.

## AC#3 — the two docset holes

**Not correctable in this repo.** `packages/platformos-check-docs-updater` has `"postbuild": "node scripts/cli.js download data"`, which refetches `data/filters.json` from `https://documentation.platformos.com/api/liquid/filters.json` and overwrites it on every build. An edit there is reverted by the next build — and would look like the hole was closed while the check quietly went back to reporting nothing. `filters.json` was left untouched.

So the second route: `DOCSET_RETURN_TYPE_GAPS`, named explicitly as a data defect. Two properties keep it from becoming a second, quieter mapping table:

1. `variableTypeOf` consults it **only** where the docset has no data at all (absent, empty array, or a single entry whose `type` is `''`) — never over a spelling it declines to interpret.
2. A spec asserts the table and the docset's actual holes are the **same set**, computed from the shipped data. If the docs team fixes these upstream, that test fails and tells us to delete the workaround; if another filter loses its `return_type`, it fails and demands a decision.

`nl2br` is in the table because `expandAliases` re-emits the entry — missing `return_type` included — under the alias name.

**Follow-up that is not mine to make:** the real fix is the documentation API carrying `return_type` for `array_index_of` and `new_line_to_br`. Worth reporting to the platformOS docs team.

## AC#5 — nested subscripts

Recorded at the call site (`accessorOf`) **and** asserted as behaviour, so the gap is a recorded fact rather than something inferred from silence. Two measurements decided it:

- `x[0]['k']` on an Array raises `"x[0] is a, expected Hash or Array"` — answering needs the type of `x[0]`, and nothing tracks element types.
- `x['a'][0]` **renders** when `x['a']` is a Hash — so "the last subscript must match the container" is not the rule either. A check built on that assumption would refuse working code, which is why silence beats a cheap guess here.

A second test pins that the gap is bounded to the nesting: `x['k'][0]` on an Array still reports, because the runtime still raises "expected index". Losing that would turn a bounded gap into a blanket exemption.

## Sweep extended: 163 -> 173

The TASK-36 sweep now covers the newly-reportable names. The generator gained invocations for them; the spec now imports `DOCSET_RETURN_TYPES`, `DOCSET_RETURN_TYPE_GAPS` and `variableTypeOf` from the check rather than restating the mapping, so the sweep can no longer agree with a copy of the rules while the real ones drift.

`UNTYPED_RETURN_TYPE_SPELLINGS` is down to two entries, both deliberate rather than unmeasured: `untyped` (type depends on the input — `first` of an Array of Hashes is a Hash) and `'string, nil'` (a union). Neither is narrowable by a single probe.

## Architecture notes

- `variableTypeOf` now takes a structural `FilterTypeSource` (`name` + `return_type[].type`) instead of the docset's full `ReturnType`. It never read the other fields, and requiring them stopped callers passing the shape they actually have.
- **Fixed a pre-existing dist leak:** `tsconfig.build.json` excluded only `**/*.spec.ts`, so the ~40 KB oracle was being compiled into the published package. Now excludes `**/*-oracle.ts` as a convention for measured test data. Verified absent from `dist`.
- Known, guarded duplication: the `.mjs` generator hand-copies the mapping tables because it cannot import TypeScript. The spec asserts every oracle row against the real `variableTypeOf`, so drift fails CI. Same shape as `verify-filter-arity.mjs`, which documents the same constraint.

## Sabotage verification

Four new sabotages, each reverted:

| # | Sabotage | Result |
|---|---|---|
| H | `date` mapping removed | 6 disagreements + coverage tripwire |
| I | `array of arrays` mapped to `string` | the `parse_csv[0]` false block, caught in the sweep and the unit test |
| J | a gap entry dropped | coverage tripwire + gap-exhaustiveness both fail |
| K | gap table allowed to win over a spelling | precedence test fails |

## Verification

319 test files / 3137 tests pass, type-check clean, prettier clean, build clean.
<!-- SECTION:NOTES:END -->
