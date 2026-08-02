---
id: TASK-42
title: >-
  LSP types the six undocumented filters as string; measured data exists to
  improve it
status: To Do
assignee: []
created_date: '2026-08-02 17:06'
labels:
  - language-server
  - docset
dependencies: []
references:
  - packages/platformos-language-server-common/src/TypeSystem.ts
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.spec.ts
  - packages/platformos-check-common/src/undocumented-filters.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`AugmentedPlatformOSDocset` injects `UNDOCUMENTED_FILTERS` as bare `{ name }` entries, and the LANGUAGE SERVER builds that same docset (`startServer.ts:166`). `TypeSystem.filterEntryReturnType` calls `docsetEntryReturnType(entry, 'string')`, so a filter with no `return_type` is typed **string**.

That means the LSP currently types all six as string, and five of those are wrong:

| filter | LSP today | measured |
|---|---|---|
| find | string | hash |
| find_index | string | number |
| h | string | string (correct by luck) |
| has | string | boolean |
| sum | string | number |
| where | string | array |

The measured data now exists — TASK-40 generated `UNDOCUMENTED_FILTER_RETURN_TYPES` from a live instance. Completions, hover and inference on a variable assigned through any of these five could be more accurate at no measurement cost.

## Why TASK-40 did NOT do this

Deliberately deferred, not overlooked. Attaching `return_type` to the entries would change LSP behaviour, and **`TypeSystem.spec.ts` injects a mock docset** — the language server's own tests never touch `UNDOCUMENTED_FILTERS`, so a regression there would not be caught by any existing test. Making a change that cannot be verified where it lands is not a trade worth taking as a side effect of a check fix.

The isolated-table design keeps the LSP delta provably zero: same code path, same input.

## What to do

Attach the measured `return_type` to the injected entries so the docset carries one fact in one place, and both consumers read it. Every spelling involved (`string`, `number`, `boolean`, `array`, `hash`) is ALREADY produced by documented filters, so no new PseudoType and no new code path is introduced.

Two details that will bite otherwise:

- **`array_value` matters.** `isArrayReturnType` returns `arrayType(returnType.array_value)`. Every documented array filter ships `array_value: ""`, so `where` must too — `{ type: 'array' }` alone yields `arrayType(undefined)`, which differs from every other array filter in the system.
- **`verify-filter-arity.mjs` scrapes `undocumented-filters.ts` with `/^\s*'([a-z0-9_]+)',$/`.** A shape change there silently extracts nothing and drops those six from `FILTER_ARITY`. A guard now throws instead of returning an empty list, but the parser still has to be updated in the same change.

## Falsifier

An LSP behaviour that is WORSE with accurate types than with the string default — for instance a completion path that relies on the string fallback to offer anything at all. That would mean the default is load-bearing rather than merely a default, and this task should be closed rather than implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The six injected entries carry their measured return_type, with array_value: "" wherever the type is array
- [ ] #2 Tests drive the REAL AugmentedPlatformOSDocset rather than a mock, so the LSP path these entries actually take is exercised
- [ ] #3 The type inferred for a variable assigned through each of the six is asserted, including find -> hash and where -> array of unknown
- [ ] #4 verify-filter-arity.mjs still extracts all six names after the shape change, asserted rather than assumed
- [ ] #5 InvalidHashAssignTarget behaviour is unchanged: the sweep and its undocumented-filter pin pass without edits, since the docset now supplies what the fallback used to
- [ ] #6 The LSP-boundary comment in AugmentedPlatformOSDocset.spec.ts is updated to describe the new arrangement rather than deleted
<!-- AC:END -->
