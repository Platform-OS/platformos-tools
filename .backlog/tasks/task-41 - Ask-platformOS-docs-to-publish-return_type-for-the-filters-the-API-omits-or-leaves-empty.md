---
id: TASK-41
title: >-
  Ask platformOS docs to publish return_type for the filters the API omits or
  leaves empty
status: To Do
assignee: []
created_date: '2026-08-02 17:06'
labels:
  - docset
  - upstream
  - detection-gap
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - packages/platformos-check-common/src/undocumented-filters.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`InvalidHashAssignTarget` derives a filter's type from the docset `return_type`. Eight filters have no usable value there, so the linter carries measured workarounds instead of reading the field. Every one of those workarounds is a local copy of a fact the documentation API could simply state.

This is NOT actionable inside this repository. `packages/platformos-check-docs-updater` has `"postbuild": "node scripts/cli.js download data"`, which refetches `data/filters.json` from `https://documentation.platformos.com/api/liquid/filters.json` and overwrites it on every build — so an edit there is reverted by the next build and would look like the hole was closed while the check quietly went back to reporting nothing.

## What to ask for

**Two documented filters whose `return_type` is present but unusable** (`DOCSET_RETURN_TYPE_GAPS`):

| filter | current `return_type` | measured |
|---|---|---|
| array_index_of | `[{ type: "" }]` — empty string | Integer -> `number` |
| new_line_to_br | absent entirely | String -> `string` |

**Six filters absent from `filters.json` altogether**, which the runtime provides and which this repo has to carry in `undocumented-filters.ts` purely so `UnknownFilter` does not refuse working code (`UNDOCUMENTED_FILTER_RETURN_TYPES`):

| filter | measured |
|---|---|
| find | Hash -> `hash` |
| find_index | Integer -> `number` |
| h | String -> `string` |
| has | Boolean -> `boolean` |
| sum | Integer -> `number` |
| where | Array -> `array` |

The six are the more valuable ask: documenting them at all would let `undocumented-filters.ts` shrink, and that module exists only because the API is incomplete. `sum`, `where`, `find`, `find_index` and `has` are names an agent reaches for by habit from Shopify Liquid.

## Evidence

All eight measured against a live instance (`liquid_exec`), by behaviour rather than by class name: `hash_assign` with a key subscript then an index, plus `type_of` to name the scalar. Recorded in `filter-return-type-oracle.ts` and in the generated comments of `undocumented-filters.ts`.

## What happens here when it lands

Nothing breaks — the docset is consulted FIRST and both fallbacks apply only where it has no data, so a published `return_type` simply takes over. The specs then fail in the useful direction: `filter-return-type-sweep.spec.ts` asserts the gap table and the docset's actual holes are the same set, so a fixed hole tells us to delete the workaround.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The ask is sent to whoever owns documentation.platformos.com/api/liquid, naming all eight filters and the measured value for each
- [ ] #2 The reply is recorded here, including a refusal or a "wont fix", so the workarounds have a documented reason to persist
- [ ] #3 If any return_type is published, the corresponding entry is removed from DOCSET_RETURN_TYPE_GAPS or UNDOCUMENTED_FILTER_RETURN_TYPES and the sweep re-run
<!-- AC:END -->
