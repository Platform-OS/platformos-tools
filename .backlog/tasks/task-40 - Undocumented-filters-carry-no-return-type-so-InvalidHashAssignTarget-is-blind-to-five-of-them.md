---
id: TASK-40
title: >-
  Undocumented filters carry no return type, so InvalidHashAssignTarget is blind
  to five of them
status: To Do
assignee: []
created_date: '2026-08-02 14:01'
labels:
  - check-common
  - detection-gap
  - docset
dependencies: []
references:
  - packages/platformos-check-common/src/undocumented-filters.ts
  - packages/platformos-check-common/scripts/verify-undocumented-filters.mjs
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-sweep.spec.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`AugmentedPlatformOSDocset.filters()` appends `UNDOCUMENTED_FILTERS` as bare `{ name }` entries — real filters, proven to exist on an instance, but absent from the docs API and therefore carrying no `return_type`.

`InvalidHashAssignTarget` resolves them through `variableTypeOf`, which sees no return-type data and no `DOCSET_RETURN_TYPE_GAPS` entry, so every one becomes `untyped` and the check says nothing about it.

Measured on a live instance (`liquid_exec`, `type_of` plus `hash_assign` with both subscripts) — five of the six return a type the check WOULD report on:

| filter | runtime type | current verdict | correct verdict |
|---|---|---|---|
| find | Hash | silent | silent — a Hash is a valid target |
| find_index | Integer | silent | should report, both subscripts |
| h | String | silent | should report, both subscripts |
| has | Boolean | silent | should report, both subscripts |
| sum | Integer | silent | should report, both subscripts |
| where | Array | silent | should report on a KEY; an index renders |

## Severity

Missed detection, never a false block — the safe direction, which is why this is medium rather than high. The cost is one broken file discovered at runtime instead of at the write gate.

Note `sum`, `where`, `find`, `find_index` and `has` are names an agent reaches for by habit from Shopify Liquid, so the gap sits on a well-travelled path rather than an obscure one.

## Where the fix belongs

The real fix is upstream: these filters should be in the documentation API's `filters.json` with a `return_type`, which would close this with no code change at all. That is not in this repo's control — `data/filters.json` is re-downloaded by the docs-updater's `postbuild` — and is worth reporting to the platformOS docs team alongside the two holes named in TASK-37 (`array_index_of`, `new_line_to_br`).

In-repo, the change is to `scripts/verify-undocumented-filters.mjs`: it already renders each candidate on a real instance and records what came back as a comment. It would have to record the measured TYPE as data, turning `UNDOCUMENTED_FILTERS` from `readonly string[]` into entries carrying a type. That module is load-bearing for `UnknownFilter` — a name that wrongly appears there silences a blocking check — so it is not a drive-by edit.

## Current state

The gap is pinned, not silent: `filter-return-type-sweep.spec.ts` names all six filters with their measured types and asserts the check stays quiet for each, so a NEW undocumented filter arriving shows up as a test failure rather than as continued silence.

## Oracle

`liquid_exec`. A bad `hash_assign` target is a runtime raise, not a converter rejection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every filter in UNDOCUMENTED_FILTERS has its return type measured against a live instance and recorded as data, not as a comment
- [ ] #2 The measurement is produced by the existing generator so a change to the undocumented list re-measures instead of requiring hand analysis
- [ ] #3 InvalidHashAssignTarget reports on the undocumented filters whose measured type is reportable, with the correct remedy for each (Array gets the numeric-index remedy)
- [ ] #4 UnknownFilter behaviour is unchanged: the shape change to UNDOCUMENTED_FILTERS must not alter which names are accepted as known
- [ ] #5 No new false block: the TASK-34 negative-space corpus and the TASK-36/37 sweep both pass, and the sweep's undocumented-filter pin is updated to assert reports rather than silence
- [ ] #6 The upstream ask is recorded: these filters plus array_index_of and new_line_to_br want return_type in the documentation API
<!-- AC:END -->
