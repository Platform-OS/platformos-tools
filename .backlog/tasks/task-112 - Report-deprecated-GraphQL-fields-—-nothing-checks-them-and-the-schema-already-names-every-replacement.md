---
id: TASK-112
title: >-
  Report deprecated GraphQL fields — nothing checks them, and the schema already
  names every replacement
status: In Progress
assignee: []
created_date: '2026-10-06 10:31'
updated_date: '2026-10-06 11:52'
labels:
  - check-common
  - measured
  - graphql
  - deprecation
dependencies: []
references:
  - packages/platformos-check-common/src/checks/deprecated-filter/index.ts
  - packages/platformos-check-common/src/checks/graphql/index.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-common/src/test/mock-docset.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
  - packages/platformos-mcp-supervisor/src/check-docs.ts
  - packages/platformos-common/src/graphql/parse.ts
  - packages/platformos-common/src/app/types.ts
modified_files:
  - >-
    packages/platformos-check-common/src/checks/deprecated-graphql-field/index.ts
  - >-
    packages/platformos-check-common/src/checks/deprecated-graphql-field/index.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
priority: medium
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The gap

A GraphQL query that uses a deprecated field is approved by every check in the toolchain. It executes correctly, so nothing fails — and the schema already carries the platform's own replacement text for almost every one of them.

Measured against `desksnearme/app/graph/graph/schema.graphql`:

| | count |
|---|---|
| `@deprecated` directives in the SDL | 234 |
| ...carrying a `reason` | 234 (all) |
| ...whose reason names a replacement ("Use records", "use property upload") | 206 |
| deprecated root queries | 21 of 58 (36%) |
| deprecated root mutations | 52 of 145 (36%) |

Deprecated **filters** and **tags** are reported (`DeprecatedFilter`, `DeprecatedTag`, both WARNING). Deprecated GraphQL fields are not, and the reason is structural rather than an oversight: `GraphQLCheck` runs `validate(schema, document)` with graphql-js's default rule set, and `NoDeprecatedCustomRule` is deliberately **not** in `specifiedRules` — it is opt-in. Measured: `specifiedRules.some(r => r.name === 'NoDeprecatedCustomRule')` is `false` on the installed graphql 16.14.2.

## The implementation is graphql-js's own rule

`graphql` is already a dependency (`^16.12.0` declared, 16.14.2 installed) and exports `NoDeprecatedCustomRule` from its index. Measured against the real 306 KB SDL:

    query { models(per_page:1){ results { id } } }
      standard rules : (none)
      NoDeprecatedCustomRule : "The field RootQuery.models is deprecated. Use records"

    mutation { transactable_create(transactable:{}) { id } }
      NoDeprecatedCustomRule : "The field RootMutation.transactable_create is deprecated. use Models instead of Transactables"

    query { records(per_page:1){ results { id } } }
      NoDeprecatedCustomRule : (none)

The message carries the platform's own reason verbatim, so the check authors no prose about the platform — the same division `platformos-mcp-supervisor/src/check-docs.ts` states as an invariant.

It also covers deprecated **enum values, arguments and input fields**, not only fields, which is where most of the real corpus hits land (below).

`GraphQLCheck` is not touched. The new check runs only `[NoDeprecatedCustomRule]`, so the two rule sets stay disjoint and a regression in one cannot silence the other.

## Position: exact character offsets, no shared helper needed

`parseGraphql` (`platformos-common/src/graphql/parse.ts:52`) calls `parse(content)` with no options, so `noLocation` is `false` and locations are retained. `error.nodes[0].loc` therefore gives the offsets of the field itself — measured: `{ start: 10, end: 16 }` slicing to exactly `"models"` on a three-line query.

That is better than `lineToRange` (exported from `checks/graphql/index.ts`), which highlights the whole line. Use `loc` and fall back to the line range only when `nodes[0].loc` is absent, so the check needs no cross-check import and `checks/graphql/index.ts` is left alone.

## Exposure, measured on the canonical corpus

`supervisor-tests/auto-eval/substrate-large` (2,768 Liquid files, 322 `.graphql` files, a real deployed application):

| | count |
|---|---|
| `.graphql` files with at least one deprecation | 24 |
| total reports | 25 |
| files with a syntax error (check must stay silent) | 7 |

By field:

    7  RootMutation.model_create
    4  ApiCallSendPayload.errors
    4  RootMutation.model_update
    2  RootMutation.admin_translation_delete
    2  NotificationSendEmailPayload.errors
    1  RootMutation.admin_translation_create
    1  RootMutation.admin_translation_update
    1  Model.related_models
    1  RootQuery.user_session_create / user_session_destroy / RootQuery.instance

Two things follow. The blast radius is small — 25 reports over 322 files — so this needs no staged rollout, no opt-in severity and no config gymnastics. And over half the hits are on **nested object fields** (`ApiCallSendPayload.errors`, `Model.related_models`), not root fields, so a check scoped to root fields only would miss most of them.

## It must NOT be added to BLOCKING_CHECKS

`platformos-mcp-supervisor/src/result/blocking.ts` states the membership rule: a member means the file is **broken**, measured against a live instance, and "MEMBERSHIP IS ESTABLISHED BY MEASUREMENT, NOT BY READING THE CHECK'S NAME."

A deprecated field executes correctly and returns data. It clears neither bar. It belongs in the allowlist's own "NOT BLOCKING — hygiene, degraded-but-working output. Still REPORTED" category, exactly where `DeprecatedFilter` and `DeprecatedTag` sit.

## The supervisor needs no change at all

`check-docs.ts` builds its lookup from `allChecks` at load time, by design: *"a check renamed, removed or added upstream changes this map without anyone editing it."* Description, documentation URL and severity all flow through. Registration in `checks/index.ts` is the only wiring.

This should be confirmed rather than assumed — see the acceptance criteria.

## No autofix suggestion, deliberately

`DeprecatedFilter` offers a rename corrector because a filter's successor is a drop-in name. A deprecated GraphQL field's successor generally is not: `models` to `records` changes the argument names, the filter input type and the return shape. A corrector would produce a query that no longer validates, which is worse than no corrector. The reason text is the guidance; `suggest` stays undefined.

## Scope ceiling: `.graphql` files only

`SourceCodeType.GraphQL` is reached only from the `.graphql` extension (`SOURCE_CODE_TYPE_BY_KEY` in `platformos-common/src/app/types.ts`), so an inline `{% graphql %}…{% endgraphql %}` body is parsed as LiquidHtml and no GraphQL-typed check sees it.

This is a pre-existing boundary, not one this task introduces: `GraphQLCheck` and `GraphQLVariablesCheck` have it too, so inline queries receive **no schema validation of any kind** today. Extending every GraphQL check across that boundary is its own task. The silence on inline bodies must be asserted here so it is deliberate and visible, not assumed.

(A precedent exists if that follow-up is taken: `checks/unknown-property/shape-analysis.ts:645` extracts an inline body with `isPlainTextBlock` / `textContentOf` and parses it with `parseGraphql`.)

## One dependency worth knowing

The check is only as accurate as the SDL the docset serves (`context.platformosDocset.graphQL()`). It cannot drift from the schema it is given — there is no second copy of the deprecation list — but a stale docset under-reports. The bundled `platformos-check-docs-updater/data/graphql.graphql` is 304 KB against 306 KB live. Keeping it current is the docs-updater's job, not this task's; worth a line in the check's description so a user can account for it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A query using a deprecated field is reported with the platform's own reason text, covering a deprecated root query, a deprecated root mutation, and a deprecated NESTED object field (the corpus majority)
- [x] #2 A deprecated enum value, argument and input field are each reported or each explicitly asserted as out of scope — whichever NoDeprecatedCustomRule actually does, established by test rather than by reading its docs
- [x] #3 A query using only current fields produces no offense, asserted in the same spec file so the positive and negative cases cannot drift apart
- [x] #4 A file with a GraphQL syntax error produces no deprecation offense (GraphQLCheck already reports the syntax error); 7 of the 322 corpus files are in this state
- [x] #5 A missing or null docset schema produces no offense and does not throw, matching GraphQLCheck's behaviour for the same condition
- [x] #6 GraphQLCheck's own spec passes unchanged and checks/graphql/index.ts is not modified, so the two rule sets stay disjoint
- [x] #7 Severity is WARNING and recommended is true, matching DeprecatedFilter and DeprecatedTag; the justification is the measured blast radius of 25 reports over 322 corpus files
- [x] #8 The check is NOT added to BLOCKING_CHECKS, and that decision is recorded with the reason (a deprecated field executes correctly, so it clears neither membership bar in blocking.ts)
- [x] #9 No autofix or suggestion is offered, and the spec asserts suggest is undefined so a future contributor does not add a corrector that produces an invalid query
- [x] #10 Inline {% graphql %} bodies are asserted to produce no offense, so the .graphql-only scope is deliberate and visible rather than assumed
- [x] #11 The supervisor requires no source change: verified by a test or recorded measurement showing the new check's description and documentation URL reach check-docs.ts through allChecks
- [x] #12 A sweep of supervisor-tests/auto-eval/substrate-large reports exactly the 24 files / 25 offenses measured in the description; a different count means the check is over- or under-firing and is investigated before merge
- [x] #13 Deliberately reverting the check's core condition makes the new tests fail (sabotage-verified), recorded in the task notes
- [x] #14 meta.docs.url follows the existing convention (documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-graphql-field); if that page does not exist yet, the task notes say so explicitly rather than leaving a link that 404s
- [x] #15 The reported range is the deprecated NAME's offsets — node.name.loc, falling back to node.loc for an EnumValue which has no .name — asserted by slicing the source and comparing to the name; a Field node's own range spans its alias and whole sub-selection and must not be used
<!-- AC:END -->



































## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented

`packages/platformos-check-common/src/checks/deprecated-graphql-field/{index.ts,index.spec.ts}`, plus two lines of registration in `checks/index.ts` (import + `allChecks` entry, both in alphabetical position). Nothing else changed. `dist/` is gitignored, so the build it needed leaves no trace.

55 registered checks, up from 54.

## Three things settled by measurement, against what the task assumed

**1. The range must come from the node's NAME, not the node.** The task's AC #4 said to use `error.nodes[0].loc`. Measured, that is wrong for three of the four kinds — a `Field` node spans its alias and its entire sub-selection:

| kind | `node.loc` | `node.name.loc` |
|---|---|---|
| `Field` | `a: models { total_entries }` | `models` |
| `Argument` | `old: "x"` | `old` |
| `ObjectField` | `old_id: "1"` | `old_id` |
| `EnumValue` | `OLD` | (no `.name`) |

So a deprecated field with a 40-line selection would have been reported across all 40 lines. The check prefers `name?.loc` and falls back to `node?.loc`, which is exactly right for `EnumValue`. Two spec cases pin this, and sabotaging it to `node?.loc` fails both.

**2. There is no "line-range fallback", and AC #4's second clause was unimplementable.** `parseGraphql` calls `parse(content)` with no options, so locations are always retained; and `GraphQLError.locations` is itself derived from `nodes[0].loc`, so a line fallback would be unreachable code fed by the same absent source. `MissingTable` already establishes the convention for a node with no location — `?? 0` — and that is what is used. AC #4 has been amended.

**3. The rule covers four kinds, not one.** AC #2 asked which. Measured: field, argument, enum value and input field, each carrying the schema's own reason. It also does **not** throw on a schema-invalid document and still finds the deprecation beside the invalid part, so no "skip invalid documents" guard was added — one mistake elsewhere in a file does not hide its deprecations. Five spec cases, one per kind plus the invalid-document case.

## Verification

- **15 spec cases**, all passing, run through the real `check()` engine.
- **Full check-common suite: 1889 tests, 109 files, all passing.** `tsc --noEmit` clean. Prettier clean.
- **Supervisor suite: 563 tests, 25 files, all passing.**
- **Supervisor needs no source change (AC #12), verified rather than assumed:** `checkDocs('DeprecatedGraphQLField')` returns the description and URL through `allChecks`, `registeredCheckCodes()` includes it, and `BLOCKING_CHECKS.has(...)` is `false`.
- **Sabotage-verified (AC #14)**, three independent ways: swapping `[NoDeprecatedCustomRule]` for the default rule set fails 10 of 15; using `node?.loc` instead of the name fails 2; dropping the no-schema guard fails 1. Restored, 15/15.
- **Corpus sweep (AC #13): exactly 24 files / 25 offenses on `substrate-large`**, matching the figure in the description, run through the real check engine with the real cached docset SDL (`~/.cache/platformos-liquid-docs-nodejs/graphql.graphql`, 304 KB, 234 `@deprecated`). Breakdown:

      7  RootMutation.model_create          2  NotificationSendEmailPayload.errors
      4  ApiCallSendPayload.errors          1  RootMutation.admin_translation_create
      4  RootMutation.model_update          1  RootMutation.admin_translation_update
      2  RootMutation.admin_translation_delete   1  Model.related_models
      1  RootMutation.user_session_create   1  RootMutation.user_session_destroy
      1  RootQuery.instance

  Note the composition: 7 of 25 are on nested object fields (`ApiCallSendPayload.errors`, `Model.related_models`), which is why AC #1 required a nested case.

## A pre-existing issue found, NOT caused by this change — worth its own task

Running `platformos-check-node`'s `check(root)` over `substrate-large` reports **0 offenses for `GraphQLCheck` and 0 for this check**, while `GraphQLVariablesCheck` (29) and `MissingTable` (6) report normally. Those two are the GraphQL-typed checks that do *not* need an SDL; the two that do are both silent.

`getPlatformOSDocset().graphQL()` returns 304,044 bytes when called directly, and that SDL builds and yields the deprecation, so the schema is available in this environment. The failure is somewhere between the docset and the check in the `check-node` path, and it affects `GraphQLCheck` — an `ERROR`-severity `BLOCKING_CHECKS` member — identically. That means schema validation may be silently off in `pos-cli check run` today.

Not investigated further here, because it is not this check's defect and chasing it would have widened the change. The corpus figure above was therefore obtained through check-common's own engine with the SDL supplied directly, which is the same code path the specs use.

## AC #15: the documentation page

`meta.docs.url` follows the existing convention exactly. The page at
`documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-graphql-field`
**does not exist yet** — it lives in the documentation repository, outside this one. Stating it per AC #15 rather than leaving a link that 404s unremarked.
<!-- SECTION:NOTES:END -->
