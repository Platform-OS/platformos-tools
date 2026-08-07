---
id: TASK-47
title: >-
  A filter in any tag ARGUMENT value is a false block — 17 positions, one shared
  grammar rule
status: Done
assignee: []
created_date: '2026-08-03 11:13'
updated_date: '2026-08-03 12:16'
labels:
  - liquid-html-parser
  - false-block
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/liquid-html-parser/grammar/liquid-html.ohm
modified_files:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - packages/liquid-html-parser/src/stage-1-cst.ts
  - packages/liquid-html-parser/src/stage-2-ast.ts
  - packages/platformos-check-common/src/checks/filter-without-effect/index.ts
  - >-
    packages/platformos-check-common/src/checks/filter-without-effect/index.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-node/configs/all.yml
  - packages/platformos-check-node/configs/recommended.yml
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
  - packages/prettier-plugin-liquid/src/printer/printer-liquid-html.ts
  - docs/platformos-gotchas.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

TASK-45 widened ten tag **operands** to accept filters. The **argument values** of those same tags were never touched, and the converter accepts a filter in every one of them. `LiquidHTMLSyntaxError` BLOCKS, so this refuses working code with no workaround available to the agent.

A false block is unappealable — the agent cannot override the write gate. This is the worst severity band, and it is 17 positions rather than one.

## The mechanism, established at the CST→AST layer

All three argument-value positions bind the **filterless** rule:

```ohm
positionalArgument<delim> = liquidExpressionOrJsonLiteral<delim> ~(space* ":")
namedArgument<delim>      = variableSegment space* ":" space* namedArgumentValue<delim>
namedArgumentValue<delim> = hashPairValue<delim> | liquidExpressionOrJsonLiteral<delim>
hashPairValue<delim>      = variableSegment space* ":" space* liquidExpression<delim>
```

The parser is TOLERANT: the strict markup rule failing does not throw, it stores markup as a raw **string**, and `InvalidTagSyntax` reports that. Measured directly rather than inferred from diagnostics — 14 of 19 argument-value constructs come back with `typeof node.markup === 'string'`; every filterless control came back structured.

This is **one shared rule** (`liquidExpressionOrJsonLiteral`) used by every tag that takes arguments — a class, not a list.

## Independently re-verified (paired, filterless control alongside each)

| construct | supervisor | control |
|---|---|---|
| `{% log 'm', type: 't' \| upcase %}` | BLOCKS | allows |
| `{% response_status 200 \| plus: 0 %}` | BLOCKS | allows |
| `{% export x, namespace: 'n' \| upcase %}` | BLOCKS | allows |
| `{% sign_in user_id: 1 \| plus: 0 %}` | BLOCKS | allows |
| `{% redirect_to '/p', status: 301 \| plus: 0 %}` | BLOCKS | allows |

The eval reports all 17 accepted by `pos-cli deploy --dry-run` with a filterless control accepted for each.

Named-argument positions affected: `render`, `include_form`, `cache`, `log`, `sign_in`, `background`, `redirect_to`, `spam_protection`, `context`, `transaction`, `form`, `theme_render_rc`. Plus `log` positional, hash-pair values, `export` namespace, and the `response_status` operand.

**`background` fails worse.** The raw-markup fallback turns `{% background … %}` into a non-block tag, so `{% endbackground %}` has no opener and stage 2 throws `LiquidHTMLASTParsingError: Attempting to close LiquidTag 'background' before it was opened`. Verified with a correctly-shaped control — note the block form takes ONLY named arguments, so a positional fixture fails for an unrelated reason and will mislead.

## Two positions in the same enumeration are NOT defects

`graphqlNamedArgumentValue` and `function`'s arguments already parse structurally, and a filter argument (`{{ 'a' | append: 'b' | upcase }}`) is allowed. Do not widen these.

## Constraints

`liquidFilteredExpression` already exists from TASK-45 — reuse it, do not invent a parallel rule. Prefer `liquidFilter+` over `*`: with `*` the filterless form still matches the first alternative and wraps every argument in a needless `LiquidVariable`, which broke 34 assertions last time; `+` falls through to the bare alternative at zero fixture cost.

A grammar change is a FIVE-layer change (see CLAUDE.md "Changing the grammar"). The printer is the data-loss trap: markup that is a raw string today survives formatting because the printer emits raw strings verbatim. The moment it parses, the printer must know how to print it or format-on-save deletes the filter from the author's file.

The refusing positions must keep refusing — conditions, `for … in` source, range bounds, index-lookup interiors are converter REJECTIONS, and a rejection fails the whole changeset.

## Falsifier

A dry run that rejects any of the 17 buffers while its filterless control is accepted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 17 argument-value positions parse without a diagnostic, matching --dry-run
- [x] #2 Every one of the 17 still parses WITHOUT a filter — the filterless controls are fixtures, not assumptions
- [x] #3 {% background %} in both block and file form parses with a filtered argument, and the stage-2 cascade throw is gone
- [x] #4 The refusing positions still refuse: conditions (if/unless/elsif, both comparison sides), for … in source, range bounds, index-lookup interiors
- [x] #5 graphqlNamedArgumentValue and function arguments are unchanged and still parse structurally
- [x] #6 Every affected construct round-trips through prettier-plugin-liquid unchanged — verified, not assumed, because the printer regenerates from the AST
- [x] #7 The language server is not regressed
- [x] #8 The whole adjudication is a fixture file so it is repeatable rather than a table in a report
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STOP — the premise is more subtle than the eval established, measured against the RUNTIME

The eval settled these 17 positions against `pos-cli deploy --dry-run` only. That measures **acceptance**. It says nothing about whether the filter is **applied** — exactly the two-claims-in-one-sentence trap Rule 9 exists for, and it changes what the correct fix is.

Measured against `/api/app_builder/liquid_exec` on `fk-docs.ps-01`, three independent lenses:

| probe | result | lens |
|---|---|---|
| `{{ 'a' \| no_such_filter_xyz }}` | **RAISES** `Liquid::UndefinedFilter` | control — the method detects application |
| `{% assign x = 'a' \| no_such_filter_xyz %}` | **RAISES** | control — same |
| `{{ 'a' \| upcase: 1, 2, 3 }}` | **RAISES** `Liquid::ArgumentError` | control — second error class |
| `{% log 'm', type: 't' \| no_such_filter_xyz %}` | renders clean | the FF-02 argument position |
| `{% cache 'k' \| no_such_filter_xyz %}x{% endcache %}` | renders clean | a TASK-45 operand |
| `{% cache 'k' \| upcase: 1, 2, 3 %}x{% endcache %}` | renders clean | same, different error class |
| `{% case 'a' \| upcase %}{% when 'A' %}…{% when 'a' %}… %}` | matches **`'a'`** | **direct observation** |
| `{% session s = 'a' \| no_such_filter_xyz %}` | **RAISES** | positive control — see the boundary below |

The `case` row is the strongest evidence available: the filter's effect on control flow is directly observable, and the unfiltered branch wins. The filter is not applied.

## The real rule, and it is NOT the one TASK-45 recorded

TASK-45 concluded "filters are accepted wherever the platform parses a full Liquid **Variable**, and refused wherever it parses a bare **Expression**", derived from converter acceptance. Measured against the runtime, converter-acceptance splits in two:

| position | converter | runtime |
|---|---|---|
| `{% assign %}`, `{{ }}`, `{% session %}` — bind `liquidVariable` | accepts | **applies the filter** |
| cache key, case subject, `log`, and every tag ARGUMENT value | accepts | **silently ignores the filter** |

That matches Ruby Liquid's tag-attribute scanning: `TagAttributes` captures `QuotedFragment`, which explicitly excludes `|`. The platform never sees the filter as part of the value.

## Why this changes the fix

A filter in these positions is **dead code**. So:

- blocking it is still a FALSE BLOCK — the file deploys and works, the filter simply does nothing;
- **approving it silently is a new defect** — the author believes the filter applies and it does not. That is the "visibly wrong, still a working page" class `blocking.ts` already reasons about (`ReservedVariableName`, `TranslationKeyExists`): reported, never blocking.

So the correct outcome for all 17 positions is **parse it AND report a non-blocking diagnostic**, not merely parse it. Widening the grammar alone would trade a false block for a silent approval of code that does not do what it says.

**TASK-45 already shipped that trade** for its ten operands — they now parse clean with no diagnostic, and the filter is ignored at runtime. That needs its own follow-up; it is not in this task's scope to change unilaterally.

## Also settled: the naive widening is impossible, measured

`positionalArgument` / `namedArgument` / `liquidExpressionOrJsonLiteral` are shared between tag arguments and **filter** arguments (`arguments<delim>` is reached from `liquidFilter`). Widening them broke **every filter that takes an argument** — `{{ 'a' | append: 'b' }}` threw `Unexpected object: undefined`, 9 of 9 baseline shapes changed. The tag path must be separated from the filter path.

A further ambiguity lands the moment it is: `{% render 'p', a: 1 | plus: 1, b: 2 %}` — the filter's own `arguments<delim>` list would absorb `b: 2` as a filter argument. PEG greediness, no lookahead fixes it cleanly, and it needs its own converter adjudication.

## What is already in place, so nothing needs inventing

- `ConcreteLiquidNamedArgument.value` already admits `ConcreteLiquidVariable`
- `toNamedArgument` already routes it through `toLiquidVariable`
- `LiquidNamedArgument.value` is already `LiquidExpression | LiquidVariable | LiquidNamedArgument`
- the printer's `NamedArgument` case already recurses into `value`, and a `LiquidVariable` case exists

Correction to my own earlier reading: I took `{% graphql g = 'q', name: val | append: 'x' %}` round-tripping as proof the printer handles a filtered named argument. It is not — the filter attaches to `GraphQLMarkup.filters`, the tag's own trailing filter list, and the argument's `LiquidVariable` has `filters: []`. **Nothing today produces a NamedArgument whose value carries filters**, so that printer path is unexercised and must be verified rather than assumed.

## DELIVERED — parse AND warn, one rule over all 27 positions

Not the fix this task was filed for, because the premise was half-measured (see the STOP note). All 17 argument positions now parse, and every filter the platform ignores is REPORTED rather than passing silently.

### Grammar — mirrored, not widened

The shared rules could not be touched: `positionalArgument`/`namedArgument`/`liquidExpressionOrJsonLiteral` are reached from `liquidFilter` via `arguments<delim>`, and widening them broke **every filter that takes an argument** (`{{ 'a' | append: 'b' }}` threw `Unexpected object: undefined`; 9 of 9 baseline shapes changed). Reverted, baseline re-confirmed identical, then a parallel set added:

```ohm
tagPositionalArgument<delim> = tagArgumentValue<delim> ~(space* ":")
tagNamedArgument<delim>      = variableSegment space* ":" space* tagNamedArgumentValue<delim>
tagNamedArgumentValue<delim> = tagHashPairValue<delim> | tagArgumentValue<delim>
tagHashPairValue<delim>      = variableSegment space* ":" space* tagArgumentValue<delim>
tagArgumentValue<delim>      = tagArgumentValueWithFilters<delim> | liquidExpressionOrJsonLiteral<delim>
tagArgumentValueWithFilters<delim> = liquidExpressionOrJsonLiteral<delim> liquidFilter<delim>+
```

Swapped into the four tag-argument sites: `tagArguments`, `logArgument`, `liquidTagOpenFormMarkup`, `liquidTagExportNamespace`. Afterwards all 9 filter-argument AST shapes are **byte-identical to baseline** — the regression control that matters.

### `{% function %}`'s result filter — caught by a failing test, and it reframed the case

`{% function res = 'p', arg2: 3 | dig: 'results' %}` filters the function's RESULT. The first cut let the last argument steal it and `stage-2-ast.spec.ts` failed. Split via `resultFilterRenderArguments`, keeping `function`'s arguments filterless so the trailing `liquidFilter*` wins.

That is the correct reading, not a compromise: `{% return 'a' | upcase %}` has the same shape and was measured to APPLY. So a filter after a `function` argument was never a false block — it parses, as a result filter. `graphql` was already on its own path.

### `response_status` — a third shape, widened without widening what it accepts

Its operand is `(liquidNumber | liquidVariableLookup)`, so reusing `liquidFilteredExpression` would have changed what the tag ACCEPTS. Added `responseStatusValueWithFilters` over the same restricted operand. Verified `200`, `code`, `200 | plus: 0` parse and **`{% response_status 'abc' %}` still does not** — the control proving the restriction survived.

### Stage 1 / stage 2 — scoped, following the TASK-45 precedent

Named arguments needed **zero** stage-2 work: `LiquidNamedArgument.value` already admitted `LiquidVariable` and `toNamedArgument` already routed it through `toLiquidVariable`. Positional arguments did — `toLiquidArgument` → `toExpression` hits `assertNever` and THROWS on a `LiquidVariable`, which is how it was found. Added `LiquidTagArgument` / `ConcreteLiquidTagArgument` and `toTagArgument`, used only at the `form` and `log` sites. `LiquidArgument` is deliberately unchanged: it is also `LiquidFilter.args`, where a nested filter cannot occur.

Also fixed a pre-existing type understatement: `ConcreteLiquidTagLogMarkup.value` was `ConcreteLiquidExpression` while the grammar binds `liquidFilteredExpression`.

### `FilterWithoutEffect`

Severity WARNING, registered, factory configs regenerated, **deliberately not in `BLOCKING_CHECKS`** — the file deploys and renders.

It allowlists the positions where filters APPLY rather than enumerating the ignoring ones: the applying set is core Liquid and stable, the ignoring set grows with every new platformOS tag, so a new tag is reported by default. The cost of that direction is stated in the file rather than left to be discovered.

A purely structural "is the variable the whole markup" predicate was tried and **measured wrong**: `LiquidTag.markup` holds an applying variable for `echo`/`return` and an ignored one for `case`/`yield`. Hence the tag-name set for that one field.

### PRE-EXISTING printer corruption, found by the round-trip sweep

`{% export x, namespace: 'n' %}` was rewritten to `{% export x, namespace: namespace: 'n' %}` — which does not parse — on **every** format. The printer prefixed a literal `'namespace: '` before a `NamedArgument` that prints its own name. The filterless form corrupted identically, so this predates filters and hit every `{% export %}` with a namespace. Fixed.

### Verification

- Full suite **324 files / 3203 tests, exit 0**; `yarn build` clean; `format:check` clean.
- Parser suite 292/292, with the filter path byte-identical to baseline.
- 12 widened constructs plus `response_status` round-trip through prettier: filters preserved, idempotent, both prettier majors.
- Check spec 7/7. **Three sabotages, all bite**: allowlist removed -> silence control fails; structural markup predicate restored -> reporting sweep fails; no-filter guard removed -> graphql control fails.

**Sabotage found a vacuous test of my own.** "Stays silent when there is no filter" passed with the guard deleted, because an unfiltered tag argument produces no `LiquidVariable` at all — the guard is unreachable from those fixtures, so the test was decorative. Replaced with `{% graphql g = 'q', name: val %}`: the one position that ALWAYS builds a `LiquidVariable`, with `filters: []` by construction. Without the guard, every graphql named argument in every project would be warned about.

**A fixture bug of my own**, caught by its own control: the filterless spellings were derived from the filtered ones by regex, which silently failed to strip `| plus: 0`, so a "filterless" fixture still carried a filter. Replaced with explicit paired spellings — which also mirrors how the runtime measurement was done.

**LSP not regressed, and slightly improved.** No language-server file touched; no LSP reference to the new types. Its `LiquidVariable` case descends into `filters` generically, so a filtered tag argument now gets filter-name completion where the markup was previously an unparsed string.

### Harness

`eval/filter-effect-sweep.mjs` — the runtime applies/ignores sweep with its controls, so the adjudication is repeatable rather than a table in a note. It carries its own recorded fixture trap: the endpoint parameter is `content`, not `template`, and the wrong name returned a uniform "unparseable" for all 27 rows — caught only because the controls failed too (rule 10).

### Follow-ups this pass created or left open

- The PEG ambiguity `{% render 'p', a: 1 | plus: 1, b: 2 %}` — the filter's own argument list absorbs `b: 2`. Unsettled; needs a converter adjudication. Not reachable for `function`/`graphql`, which keep filterless arguments.
- The `{% export %}` printer corruption is fixed here but was PRE-EXISTING and unrelated to filters; worth its own note in any changelog since it silently produced unparseable files.
- TASK-52 (instructions wording) is now unblocked on this side.
<!-- SECTION:NOTES:END -->
