---
id: TASK-79
title: >-
  One LiquidType symbol table: resolve locally-assigned variables in the
  argument-type checks
status: Done
assignee: []
created_date: '2026-08-15 20:40'
updated_date: '2026-08-16 05:59'
labels: []
dependencies: []
references:
  - /home/mkk/.claude/plans/swift-twirling-sifakis.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`{{ 403 | t }}` reports a type mismatch, but `{% assign x = 403 %}{{ x | t }}` does not. Three checks carry the same deliberate bail — a bare `VariableLookup` resolves to `untyped` because "there is no symbol table at a filter call".

A `LiquidType` symbol table already exists privately inside `InvalidHashAssignTarget`. Promote it to a shared, per-file, memoized module (`src/variable-types.ts`), give it the scope handling `shape-analysis.ts` already proved (branch scoping, loop shadowing, unparseable-markup invalidation), and have all four checks read it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% assign x = 403 %}{{ x | t }}` reports the same message `{{ 403 | t }}` reports, with a control asserting `{% assign x = 'a' %}{{ x | t }}` stays silent
- [x] #2 One LiquidType table in check-common, consumed by ValidFilterArgumentTypes, ValidTagArgumentTypes, ValidRenderPartialArgumentTypes and InvalidHashAssignTarget — the private tracker in InvalidHashAssignTarget is deleted, not duplicated
- [x] #3 A write inside an {% if %} branch is not a fact past {% endif %}; a loop variable shadows an assigned name over the body and the outer binding is restored after
- [x] #4 {% doc %} @param types seed the table for the file that declares them; a type the docset vocabulary does not map (`{current_user}`, `string[]`) seeds nothing
- [x] #5 Every new silence assertion is paired with a control that must still fire, and each new assertion fails when the code is deliberately broken
- [x] #6 Sweep of the real projects in ~/projects/pos shows no false positives from the three arg-type checks getting louder
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New `src/variable-types.ts` holds one per-file `LiquidType` table, memoized on `AppFile.derived` and consumed by ValidFilterArgumentTypes, ValidTagArgumentTypes, ValidRenderPartialArgumentTypes and InvalidHashAssignTarget (whose private tracker is deleted). `enclosingBranchEnd` moved to `utils/ast.ts` and is now shared with `shape-analysis.ts`.

Types come from the docset: filter chains through `filters.json` `return_type` (`filterChainType`), tags through a new `tagReturnTypes()` reading `tags.json` `return_type` with the same `docsetReturnType` resolution. `tags.json` publishes `[]` for every tag today, so a 4-row `MEASURED_TAG_TYPES` fallback (capture/graphql/increment/decrement) is consulted only where the docset has no row — a `@return` annotation upstream retires each row with no code change. `parse_json` is not in it: its type is read from the body (`[` → array, `{` → object), which fixes a live false positive where an array body was reported as a Hash append.

Runtime measurements taken (arabbank `dev`):
- `{{ 403 | t }}` and `{% assign x = 403 %}{{ x | t }}` raise the identical error — the premise.
- `{% increment c %}{{ c }}` renders `1`, but `{% assign d = 'str' %}{% increment d %}{{ d }}` renders `str` in either order — so a counter binds only where nothing else does.
- `{% for i in (1..5) limit: "2" %}` renders; `limit: "abc"` raises `invalid integer`.

Two bugs found by the tests rather than by review: a subscripted append (`x['k'] << v`) must let the subscript win over the operator, and a `forget` must close ranges at the unreadable tag's START (a consumer querying a tag's `position.start` lands on the end offset when tags abut).

Sweep of 4 real projects: arabbank 0, Accala-MP 0, htevent 2, pos-module-community 7. All read; no false positives. The 6 render-partial ones are genuine `{% doc %}` under-declarations in pos-module-community (`session/set` declares `@param {string} value` then does `value | json`). The 2 htevent ones are `{% assign limit = '10' %}` into `for limit:`, doc-faithful but runtime-coercing — a pre-existing judgement of the check for literals, now reaching variables.

Perf: +~1.8% on a full lint of pos-module-community (11.57s vs 11.35s median of 4), one memoized AST walk per file shared by four checks.

Follow-up (same session): closed the upstream gap rather than living with the fallback.

The issue was in **desksnearme**, not platformos-documentation. `platformos_tags.liquid` already looped over `item.returns` and emitted `return_type` — its own comment said so — but `docs/generators/liquid_tags/default/module/setup.rb` never serialized a `returns` key, so the loop ran zero times and all 33 tags published `[]`.

desksnearme: `tag_serialized` now emits `returns` from `@return`, identical in shape to the filters generator; `@return` added to graphql/execute_query/query_graph (`object`), parse_json/function (`untyped`); `verify_tags_json.rb` gates return types against the same vocabulary as parameters. Generator re-run: 5 documented return types, gate green; sabotaged with `@return [Hash]` and it aborts naming `graphql (return)`.

platformos-documentation: core Liquid tags have no handler class to annotate (the platform never registers them), so capture -> string and increment/decrement -> number were authored in the hand-written `standard_tags.liquid`; stale comment in `platformos_tags.liquid` corrected; added a Returns section to the tags page template mirroring `filter.liquid`.

Verified end to end by piping the regenerated tags.json through the partial's transform into `tagReturnTypes()`: graphql/execute_query/query_graph -> object, and standard_tags gives capture -> string, increment/decrement -> number. All four `MEASURED_TAG_TYPES` rows are therefore superseded and retire themselves once the docs deploy.
<!-- SECTION:NOTES:END -->
