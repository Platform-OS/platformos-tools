---
id: TASK-34
title: >-
  Negative-space fixtures: assert where each blocking check must stay SILENT,
  not only that it fires
status: Done
assignee: []
created_date: '2026-08-02 07:09'
updated_date: '2026-08-07 12:45'
labels:
  - mcp-supervisor
  - check-common
  - false-block
  - testing
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
  - /home/ecgtheow/Work/supervisor-tests/eval/METHODOLOGY.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Every guard in this repo asserts that checks FIRE. `blocking-emission.spec.ts` proves each of the eleven blocking codes can be produced. `file-type-coverage.spec.ts` proves each admitted file type produces a diagnostic for a broken buffer. Nothing anywhere asserts that a check stays SILENT on input the platform accepts.

That asymmetry is how TASK-33 happened: a decision measured against the converter, written into a check docstring and into the agent-facing server instructions, was silently reversed by a dependency default while the whole suite stayed green.

It is also the asymmetry that matters most. A missed detection costs one broken file the agent discovers later. A false block is an unappealable refusal: the agent cannot write correct code and has no override. Across four evaluation rounds the false-block count has not moved (6, 6, 6, 6), and every one of those was found by an external evaluator running a live deploy oracle, never by this repo's own suite.

## What this is

The mirror of `blocking-emission.spec.ts`. For each code in `BLOCKING_CHECKS`, a table of inputs that are KNOWN-VALID against the platform, asserted to produce nothing from that check.

The point is not coverage for its own sake. It is that a false block becomes detectable in CI, so the next one does not need an external evaluation and a live instance to find.

## Where the inputs come from

Round 4 already did the expensive part for YAML: 50 of 52 valid-but-unusual shapes were confirmed clean across all four file types, and the two that were not are TASK-33. That corpus should be imported rather than re-derived. `FINDINGS-ROUND4.md` lists the shapes; `METHODOLOGY.md` records which oracle settled each one.

For the Liquid blocking checks, the round-4 `InvalidHashAssignTarget` set is 31 structural cases with zero false blocks, run in both tag spacings. Same treatment.

## Constraint

A fixture is only worth having if its validity was established, not assumed. Round 4 recorded three of its own fixture errors, two of which were "invalid" YAML controls that were actually valid. Each entry must carry the oracle that certifies it, or it is a guess pinned as a fact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every code in BLOCKING_CHECKS has at least one pinned VALID input that must produce no diagnostic from that check, with a note recording which oracle established the input is valid
- [x] #2 The set of covered codes is derived from BLOCKING_CHECKS itself, so adding a blocking code without must-stay-silent coverage fails, the same way blocking-emission.spec.ts derives its EMITS set
- [x] #3 The YAML corpus is seeded from the 50 valid-but-unusual shapes round 4 proved clean: anchors, aliases, merge keys, all block-scalar forms, explicit and custom tags, BOM, CRLF, multi-document, document-end markers, bare scalars, top-level sequences, deep nesting, very long lines, non-ASCII keys, directives, flow collections
- [x] #4 Sabotage-verified: reverting the TASK-33 parser option makes this suite fail, proving the corpus can actually detect a false block
- [x] #5 Each fixture records the oracle that certifies it as valid input, so a future reader can tell a measured fact from an assumption
- [x] #6 Assertions are whole-value per the repo rule: the full offense array equals the empty array, not a length or membership check
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED 2026-08-02, as `blocking-silence.spec.ts` — the mirror of `blocking-emission.spec.ts`, same shape, same derivation, opposite assertion.

CORPUS: 103 fixtures across all 11 blocking codes.

  YAMLSyntaxError                72   (36 shapes x model schema + translations)
  LiquidHTMLSyntaxError          10
  FilterArity                     4
  InvalidHashAssignTarget         4
  UnknownFilter                   3
  JsonLiteralQuoteStyle           3
  MissingPartial                  2
  GraphQLCheck                    2
  GraphQLVariablesCheck           1
  MissingRenderPartialArguments   1
  MissingContentForLayout         1

BUILT BY MEASURING FIRST, not by writing assertions and hoping. A throwaway probe ran every candidate through the real pipeline and dumped what each produced; only then were the results pinned. That is what caught the fixture error below, and it is the discipline the corpus is worthless without.

EVERY FIXTURE RECORDS ITS ORACLE, as a required field on the type rather than a comment:
  dry-run          the converter accepted this shape (round-4 O1c)
  runtime          executed via liquid_exec and rendered (round-4 O1a)
  generated-data   follows from filter-arity.ts / undocumented-filters.ts, both generated FROM the runtime
  schema           valid against the project GraphQL schema the check validates against
  by-construction  valid because the fixture's own project makes it so (the partial exists, the variable is declared)

The distribution is itself pinned, because `by-construction` is the weakest claim available and a code drifting toward it is a real loss of evidence that would otherwise pass unnoticed.

MY OWN FIXTURE ERROR, recorded because the methodology says to. Both GraphQL fixtures began as `records { results { id } }`, which I believed valid. The schema requires `per_page`, so the check reported them — correctly. Had I written the assertions from confidence instead of from the probe, I would have filed a false block against a check that was right. Same shape as the two round-4 fixture errors: an observation about my input read as an observation about the tool. It is recorded in the file, at the fixture.

SABOTAGE-VERIFIED, four mutations, each restored after measuring, each failing exactly the intended code:
  1. revert TASK-33's `uniqueKeys: false`            -> YAMLSyntaxError silence fails
  2. drop `sum` from undocumented-filters.ts         -> UnknownFilter silence fails
  3. give `array_map` a guessed arity                -> FilterArity silence fails
  4. add a code to BLOCKING_CHECKS with no coverage  -> exhaustiveness fails HERE and in the emission suite

Sabotage 3 is the one worth keeping: `array_map` is one of four filters the arity generator could not determine and deliberately left ABSENT rather than guessed. Giving it a guess immediately produces a false block, which is the argument `blocking.ts` makes for admitting FilterArity to the set at all — now asserted rather than argued.

CONTROLS ARE NOT DUPLICATED HERE. An assertion that nothing was reported is satisfied equally well by a check that stopped working, so silence only means something while something else proves the check still fires — which is exactly `blocking-emission.spec.ts`, for every member, from a real buffer. The one exception kept locally is the YAML control, because suppressing DUPLICATE_KEY is the specific edit that could widen into hiding a real parse failure.

ADJACENCY: both tag spacings are run wherever a fixture contains two `{% %}` tags, since the defect that motivated that axis was a check going SILENT when tags abutted — which every assertion in this file would have accepted. Measured, `LiquidHTMLSyntaxError` and `InvalidHashAssignTarget` carry the axis; I predicted `UnknownFilter` would too and it does not, because its fixtures pair a tag with an output rather than two tags. The pin records the measurement, not the prediction.

TWO PINS I GOT WRONG AND CORRECTED FROM MEASUREMENT: the FilterArity corpus size (4, not 5) and that adjacency list. Both failed on first run, which is the pins working.

SCOPE, HONESTLY: the YAML corpus is 36 distinct shapes covering every category the round-4 findings name, not the literal 52 variants that round deployed (the findings enumerate categories, not each variant). Each runs in a model schema and a translation file; the control runs in all four YAML locations.

VERIFIED: 18 tests, 6.6 s. Full monorepo green, type-check 0 errors, prettier clean.
<!-- SECTION:NOTES:END -->
