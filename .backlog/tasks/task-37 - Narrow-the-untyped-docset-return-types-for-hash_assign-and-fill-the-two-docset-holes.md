---
id: TASK-37
title: >-
  Narrow the untyped docset return types for hash_assign, and fill the two
  docset holes
status: To Do
assignee: []
created_date: '2026-08-02 07:10'
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

A filter documented `date` or `datetime` whose value legitimately accepts `hash_assign`. That would prove the conservative mapping is load-bearing rather than merely cautious, and this task should be closed rather than implemented.<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The date, datetime, time and array-of-arrays return-type spellings resolve to a modelled type, and a hash_assign onto a variable produced by a filter of each is reported with the correct remedy
- [ ] #2 Each mapping change is justified by a recorded runtime observation, not by the spelling looking scalar-like
- [ ] #3 The two docset entries with a missing or empty return_type are either corrected upstream or handled with the gap named at the call site as a data defect rather than a modelling choice
- [ ] #4 No new false block: the negative-space corpus from TASK-34 passes unchanged, and the TASK-36 sweep is re-run if it has landed
- [ ] #5 The x[0][key] case is either handled or explicitly recorded as out of scope at the call site, since only the first subscript is currently modelled
<!-- AC:END -->
