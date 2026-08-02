---
id: TASK-40
title: >-
  Undocumented filters carry no return type, so InvalidHashAssignTarget is blind
  to five of them
status: Done
assignee: []
created_date: '2026-08-02 14:01'
updated_date: '2026-08-02 17:17'
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
modified_files:
  - packages/platformos-check-common/scripts/verify-undocumented-filters.mjs
  - packages/platformos-check-common/scripts/verify-filter-arity.mjs
  - packages/platformos-check-common/src/undocumented-filters.ts
  - packages/platformos-check-common/src/undocumented-filters.spec.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.spec.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/filter-return-type-sweep.spec.ts
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.spec.ts
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
- [x] #1 Every filter in UNDOCUMENTED_FILTERS has its return type measured against a live instance and recorded as data, not as a comment
- [x] #2 The measurement is produced by the existing generator so a change to the undocumented list re-measures instead of requiring hand analysis
- [x] #3 InvalidHashAssignTarget reports on the undocumented filters whose measured type is reportable, with the correct remedy for each (Array gets the numeric-index remedy)
- [x] #4 UnknownFilter behaviour is unchanged: the shape change to UNDOCUMENTED_FILTERS must not alter which names are accepted as known
- [x] #5 No new false block: the TASK-34 negative-space corpus and the TASK-36/37 sweep both pass, and the sweep's undocumented-filter pin is updated to assert reports rather than silence
- [x] #6 The upstream ask is recorded: these filters plus array_index_of and new_line_to_br want return_type in the documentation API
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

All six undocumented filters now carry a measured return type. Five report; `find` stays silent because it returns a Hash, which is a valid `hash_assign` target.

| filter | measured | check behaviour |
|---|---|---|
| find | hash | SILENT — correct, a Hash is a valid target |
| find_index | number | reports on both subscripts |
| h | string | reports on both subscripts |
| has | boolean | reports on both subscripts |
| sum | number | reports on both subscripts |
| where | array | reports on a KEY, silent on an index |

`find` staying silent is load-bearing: a blanket "they all report now" would mean the type was never actually consulted.

## Measured by BEHAVIOUR, not by class name

`verify-undocumented-filters.mjs` measures the return type in the SAME pass that proves existence, so the two can never disagree about coverage. The verdict comes from what `hash_assign` actually did — key subscript, then index:

- key raises, index renders -> `array`
- key renders, index renders -> `hash`
- key raises, index raises -> scalar, and only then is `type_of` consulted to NAME it

That ordering matters because the runtime class is frequently not the plain thing the docs would call it (`ActiveSupport::SafeBuffer`, `JOSE::EncryptedBinary`, `Float` where docs say number). Behaviour is what the check acts on; the class name only picks the noun in the message.

Anything not matching one of those three shapes is recorded as unmeasured rather than forced into one, and an unmeasured filter stays untyped — the same safe silence it had before.

## The LSP constraint drove the design (AC#4 and beyond)

The obvious modelling — attach `return_type` to the entries themselves — was investigated and REJECTED, for a reason found rather than assumed:

- `AugmentedPlatformOSDocset` is built by the LANGUAGE SERVER too (`startServer.ts:166`).
- `TypeSystem.filterEntryReturnType` calls `docsetEntryReturnType(entry, 'string')`, so these six are currently typed **string** in completions, hover and inference.
- Attaching return types would retype five of them — probably an improvement, but **`TypeSystem.spec.ts` injects a mock docset**, so the LSP's own tests would not catch a regression.

A change that cannot be verified where it lands is not a trade worth taking as a side effect of a check fix. So the measurement went into a SECOND export consumed only by `InvalidHashAssignTarget`. `UNDOCUMENTED_FILTERS` is byte-identical — verified by diff — and `.map(toFilterEntry)` is untouched, so the LSP delta is provably zero: same code path, same input.

Two further hazards this avoided:
- `{ type: 'array' }` without `array_value: ''` yields `arrayType(undefined)` where every documented array filter yields `arrayType('')`.
- `verify-filter-arity.mjs` scrapes `undocumented-filters.ts` with `/^\s*'([a-z0-9_]+)',$/`. A shape change extracts nothing SILENTLY and drops those six from `FILTER_ARITY` — a check that stops reporting with no test noticing.

Verified the arity generator still extracts exactly the six names, and added a guard that THROWS on zero rather than returning an empty list.

The LSP improvement is real and worth having — filed as TASK-42 with the `array_value` trap written down. The `{ name }` assertion in `AugmentedPlatformOSDocset.spec.ts` is now annotated as the LSP boundary so nobody "improves" it without doing that work.

## Precedence, and a rule no real data could exercise

`variableTypeOf` consults the docset FIRST, always. Both measured fallbacks apply only where the docset has no data at all. The two are kept separate because their provenance differs — `DOCSET_RETURN_TYPE_GAPS` is "the docset has the filter but the field is empty"; the new map is "the docset does not have the filter at all".

Sabotage exposed a gap in my own tests here: inverting the precedence changed NOTHING, because no undocumented filter has a docset `return_type` — being absent from the docset is what makes it undocumented. A rule no input can exercise is a rule that quietly stops holding, so the collision is now constructed directly through `variableTypeOf` and asserted.

## Sabotage verification

| # | Sabotage | Result |
|---|---|---|
| a | lookup removed from `variableTypeOf` | 2 tests fail |
| b | `where` mistyped as string | 3 fail, incl. the Array-remedy test |
| c | `find` mistyped as string | 2 fail — the silence case bites |
| d | fallback allowed to beat a docset spelling | fails only after the precedence test was added (see above) |

## Specs

- `undocumented-filters.spec.ts` — a DRIFT GUARD asserting the two exports cover exactly the same names, plus a whole-value pin on the measured types.
- `filter-return-type-sweep.spec.ts` — the "known detection gap" test FLIPPED from asserting silence to asserting exact per-filter behaviour (AC#5), plus a test that `where` gets the numeric-index remedy rather than the Hash one (AC#3).

## AC#6

Upstream ask recorded as TASK-41: eight filters where the documentation API should publish `return_type` — these six plus `array_index_of` and `new_line_to_br` — with measured values and the note that editing `data/filters.json` is futile because the docs-updater's `postbuild` overwrites it.

## Verification

320 test files / 3157 tests pass, type-check clean, prettier clean, build clean. `UnknownFilter` behaviour unchanged (AC#4): the name list is byte-identical.
<!-- SECTION:NOTES:END -->
