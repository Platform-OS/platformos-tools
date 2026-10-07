---
id: TASK-113
title: >-
  Inline {% graphql %} bodies get no GraphQL validation at all — the same query
  in a .graphql file is a blocking error
status: In Progress
assignee: []
created_date: '2026-10-06 10:46'
updated_date: '2026-10-06 12:16'
labels:
  - check-common
  - measured
  - graphql
  - false-approval
dependencies:
  - TASK-112
references:
  - >-
    packages/platformos-check-common/src/checks/unknown-property/shape-analysis.ts
  - packages/platformos-common/src/graphql/parse.ts
  - packages/platformos-common/src/app/types.ts
  - packages/platformos-check-common/src/to-source-code.ts
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: medium
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The gap

An inline `{% graphql res %}…{% endgraphql %}` body receives **no GraphQL validation of any kind**. Not schema validation, not variable validation, not deprecation. A query written inline can reference a field that does not exist, pass a variable of the wrong type, or fail to parse, and every check in the toolchain approves the file.

The cause is structural, not an oversight. `SourceCodeType.GraphQL` is reached only from the `.graphql` file extension (`SOURCE_CODE_TYPE_BY_KEY` in `platformos-common/src/app/types.ts`), so a `.liquid` file is parsed as `LiquidHtml` and no GraphQL-typed check — `GraphQLCheck`, `GraphQLVariablesCheck`, `MissingTable` — ever sees the body.

`GraphQLCheck` is `BLOCKING_CHECKS` and `Severity.ERROR`: the same query in a `.graphql` file stops the write. Inline, it is silent.

## Measured exposure

Eight real application trees (`supervisor-tests/auto-eval/substrate-large`, `POS/tertius`, `product-marketplace-template-master`, `POS/marketplace-dcra`, `POS/pcbs`, `POS/styleseeker`, `sis`, `cittizen-dev`), validated against the live `desksnearme` SDL. Bodies deduplicated by normalised content, because `tertius` vendors a copy of `marketplace-dcra`:

| | count |
|---|---|
| inline `{% graphql %}` blocks | 955 |
| ...all-text, so parseable | 918 |
| ...containing Liquid, so not parseable at all | 37 |
| **distinct** query bodies | 311 |
| distinct bodies that are schema-invalid | **5** |
| distinct bodies with a syntax error | **2** |

The five distinct violations are all variable type mismatches, which GraphQL rejects at execution:

    Variable "$job_ids" of type "[String!]!" used in position expecting type "[ID!]".
    Variable "$permit_number" of type "String!" used in position expecting type "[String!]".
    Variable "$agency_id" of type "String!" used in position expecting type "[String!]".
    Variable "$job_change_id" of type "String!" used in position expecting type "ID".
    Variable "$permit_id" of type "String!" used in position expecting type "ID".

They are in production command code, e.g. `marketplace-dcra/app/lib/commands/v2/payment_methods/assign.liquid`:

    mutation($job_ids: [String!]!) {
      models_update_all(
        model_schema_name: "job"
        filter: { id: { value_in: $job_ids } ... }

`value_in` takes `[ID!]`; the variable is declared `[String!]!`.

`substrate-large` itself has **47 inline blocks and zero violations**, so the canonical corpus will show no delta. The findings live in the other trees.

## Verify against the platform before deciding severity

Do not infer the verdict from graphql-js. Two reasons:

1. These were validated against `desksnearme` HEAD, and these applications may target an older platform. A `String` vs `ID` mismatch can be schema evolution rather than a live defect.
2. `rejectedByThePlatform` (`platformos-common/src/graphql/parse.ts`) exists precisely because graphql-js and the platform's `graphql-c_parser` are two implementations that disagree, every case measured rather than read off the spec. One of the two syntax errors found is `Unexpected character: "\"` — and platformOS Liquid has backslash string escapes, so that is a strong candidate for a divergence rather than a defect.

Measure at least one variable mismatch and the backslash case against a live instance (`liquid-exec` carries a real controller) before choosing severity or `BLOCKING_CHECKS` membership.

## Two implementations — pick one and record why

**Option A — a new LiquidHtml check** that extracts inline bodies and validates them itself.

Self-contained and low risk. But it has to carry its own copy of what to validate, so it duplicates the rule sets of `GraphQLCheck`, `GraphQLVariablesCheck` and `DeprecatedGraphQLField` (TASK-112), and a fourth GraphQL check added later would need wiring in two places. That is the drift this repository routinely designs out — `check-docs.ts` is "a LOOKUP, not a table", `allChecks` derives `recommended`, `instructions.js` derives from the exposed set.

**Option B — make an inline body a first-class GraphQL source**, so every GraphQL-typed check runs on it unchanged.

Larger, and it touches source-code plumbing in `platformos-check-common/src/index.ts` and `to-source-code.ts`. But it fixes `GraphQLCheck`, `GraphQLVariablesCheck`, `MissingTable` and TASK-112's check in one change, and every future GraphQL check inherits inline coverage with no extra wiring.

**Recommended: B.** The gap is not "deprecations are unchecked inline", it is "nothing is checked inline", and A fixes one check's worth of a pipeline-shaped problem. Whichever is chosen, the reasoning goes in the task notes.

## The extraction already exists

`checks/unknown-property/shape-analysis.ts:645` does it today:

    const document = isPlainTextBlock(node) ? parseGraphql(textContentOf(node)) : undefined;

with `isLiquidTagGraphQL`, `isGraphQLInlineMarkup`, `isPlainTextBlock` and `textContentOf`. `parseGraphql`'s own doc comment anticipates this caller: *"an INLINE `{% graphql res %}…{% endgraphql %}` body has no file and no AppFile, so its caller calls this directly."*

Reuse it. Do not write a second extractor, and do not reach for a regex — the parser already identifies the tag and its text children.

## The hard part is offset mapping

A body parsed standalone produces **body-relative** offsets. Every diagnostic must be translated into file offsets using the position of the body's `TextNode`, or the check reports real problems at the wrong place.

This failure class has precedent here: TASK-91 (*"Frontmatter offsets drift on a CRLF file so every diagnostic after the first line points at the wrong text"*). Treat CRLF and a body that does not start at the tag boundary as first-class test cases, not as edge cases.

## Ceiling: 37 of 955 bodies cannot be parsed

A body containing `{{ … }}` or a Liquid tag is not all-text, so there is nothing to hand to a GraphQL parser. The check must stay **silent** on those rather than guess — and that silence must be asserted, the same way TASK-99 treats a variable `response_headers` argument. Silence there is not a defect; asserting it is part of the work.

## Relationship to TASK-112

TASK-112 adds `DeprecatedGraphQLField` with an acceptance criterion that asserts inline bodies produce no offense — correct for its `.graphql`-only scope. If Option B is taken, that assertion stops being true and must be updated in the same change rather than left failing or deleted. TASK-112 should land first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An inline {% graphql %} body that references a field absent from the schema is reported, with the same message GraphQLCheck gives for the identical query in a .graphql file
- [x] #2 An inline body declaring a variable of the wrong type is reported, using at least one of the five measured real-world mismatches as a fixture
- [ ] #3 An inline body that does not parse is reported as a syntax error, or is deliberately excluded with the divergence reason recorded — decided by measurement against a live instance, not from graphql-js
- [x] #4 A valid inline body produces no offense, asserted in the same spec file as the failing cases so the two cannot drift apart
- [x] #5 A body containing Liquid interpolation produces no offense and does not throw; the silence is asserted explicitly so it is deliberate rather than incidental (37 of 955 measured bodies are in this state)
- [x] #6 Reported ranges point at the offending text inside the .liquid file, verified by slicing the file source at the reported offsets and comparing to the expected substring — not by comparing line numbers
- [x] #7 Offset mapping is correct for a CRLF file and for a body that does not begin immediately at the tag boundary, each asserted separately (see TASK-91 for this failure class)
- [x] #8 The choice between Option A (a new LiquidHtml check) and Option B (inline bodies as first-class GraphQL sources) is recorded in the task notes with the reasoning, and the implementation matches it
- [x] #9 Inline extraction reuses the existing helpers in unknown-property/shape-analysis.ts rather than a second extractor or a regex; if they are moved to a shared location, unknown-property's own spec passes unchanged
- [ ] #10 At least one measured variable mismatch and the backslash syntax-error case are run against a live instance and the platform's verdict recorded, before severity or BLOCKING_CHECKS membership is chosen
- [x] #11 BLOCKING_CHECKS membership is decided on that evidence and justified in blocking.ts in the same form as every existing member, or explicitly declined with the reason
- [x] #12 If Option B is taken, TASK-112's acceptance criterion asserting inline silence is updated in this change rather than left failing or removed
- [x] #13 A sweep over the eight measured application trees reports the 5 distinct schema-invalid bodies and no others; substrate-large shows zero delta, which is expected and confirms the check is not over-firing
- [x] #14 Deliberately reverting the change makes the new tests fail (sabotage-verified), recorded in the task notes
<!-- AC:END -->

























## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented

`packages/platformos-check-common/src/checks/graphql-inline/{index.ts,index.spec.ts}` — `GraphQLInlineCheck`, a LiquidHtml check, `Severity.ERROR`, recommended. Plus:

- two lines of registration in `checks/index.ts`
- `isPlainTextBlock` and `isLiquidTagGraphQL` moved from `unknown-property/shape-analysis.ts` to `checks/utils.ts` (AC #9), which is where that category of AST guard already lives

56 registered checks, up from 55. Net diff: 16 insertions, 10 deletions across three files, plus the new directory.

## Option A, and Option B turned out to be wrong rather than merely larger

The task recommended B (inline bodies as first-class GraphQL sources). Reading the engine changed that.

`createContext`'s `report()` builds an offense with `uri: file.uri` and `getPosition(file.source, problem.startIndex)`. So **a LiquidHtml check that reports file-absolute indices gets correct positions and the correct URI for free** — no engine change, no offset translation machinery, nothing touched in `index.ts`'s dispatch loop.

Option B would have needed a synthetic source whose `source` is the whole `.liquid` file (or positions come out body-relative) while its `ast` is the body's document — two incompatible requirements in one object, plus a change to `filesOfType`. B is not a bigger version of A; it is incoherent against how positions are resolved. A is both smaller and correct.

Consequence: **TASK-112 needs no change.** Its AC asserting inline silence stays true, because `DeprecatedGraphQLField` is GraphQL-typed and still cannot see an inline body. AC #12 of this task is satisfied by not applying.

## Offsets: slice the source, never join the children

Measured across LF, CRLF, no-newline, indented, blank-line-padded and preceded-by-content bodies: for an all-text body the concatenated children `value` equals `source.slice(firstChild.position.start, lastChild.position.end)` in every case. The slice is used anyway, because it carries the offset the join does not — `startIndex` is `body.startIndex + error.nodes[0].loc.start`, exact by construction.

CRLF is a spec case, not an edge case (TASK-91's failure class). Sabotaging `startIndex` to body-relative fails 5 of 14 tests.

## The all-text guard is load-bearing, and the first version of its test was not

The obvious fixture — `{% graphql r %}{ {{ field }} }{% endgraphql %}` — passes with the guard **removed**, because that body fails to parse and the no-parse guard catches it. The test was green for the wrong reason.

The case that actually needs the guard is interpolation **inside a string literal**:

    {% graphql r %}{ nope(filter: "{{ n }}") }{% endgraphql %}

Measured: children are `["TextNode","LiquidVariableOutput","TextNode"]`, so `isPlainTextBlock` is false — but the raw slice **parses as valid GraphQL**, with `{{ n }}` read as a string value. Without the guard this is validated as written and reported against a query nobody wrote. That fixture is now the spec case, and removing the guard fails it.

## One guard dropped as unreachable

`isGraphQLInlineMarkup` was in the first draft and removed: only the block form has children, and `inlineBody` requires them, so the file-based form is already excluded by `children.length === 0`. Sabotaging the markup check changed no test, which is the correct signal for code that cannot be reached. It was returned to `shape-analysis.ts` as a private function rather than left exported from `utils.ts` for no consumer.

The spec still documents that `{% graphql r = 'some/query' %}` yields nothing, since that is behaviour worth pinning even though no single guard owns it.

## Syntax errors are deliberately excluded (AC #3) — and why, honestly

A body that does not parse is **not** reported. Two reasons, and the second is a limit of this session rather than a design preference:

1. `rejectedByThePlatform` exists because graphql-js and the platform's `graphql-c_parser` disagree in measured ways. One of the two syntax errors found in the corpus is `Unexpected character: "\"`, and platformOS Liquid has backslash string escapes — a strong divergence candidate.
2. **AC #10 could not be satisfied: there is no instance available.** `envs-list` returns zero environments, so nothing could be measured against a live platform. Deciding to report a syntax error on that basis would be exactly the guess `blocking.ts` forbids.

So the check validates bodies that parse, and is silent on bodies that do not. **AC #10 is unmet and AC #3 took its documented second branch.**

## Not in BLOCKING_CHECKS (AC #11), for the same reason

`blocking.ts` states that membership is established by measurement against a live instance. No instance was available, so membership was not claimed — verified: `BLOCKING_CHECKS.has('GraphQLInlineCheck')` is `false`. Severity is still `ERROR`, matching `GraphQLCheck` for the identical finding, and `blocking.ts` is explicit that the two are separate: a non-member stays an error and keeps `status: 'error'`, it just does not gate the write.

Revisiting membership once an instance is available is the natural follow-up, together with measuring the backslash case.

## Verification

- **14 spec cases**, all passing, through the real `check()` engine.
- **Full check-common suite: 1903 tests, 110 files, all passing** (was 1889/109). `tsc --noEmit` clean, Prettier clean.
- **Supervisor suite: 563 tests, 25 files, all passing.** `checkDocs('GraphQLInlineCheck')` resolves through `allChecks` with no supervisor source change.
- **`unknown-property` suite: 116 tests passing** after the guard move (AC #9).
- **Sabotage-verified five ways** (AC #14): all-text guard → 1 fails; body offset → 5 fail; source slice replaced by a zero base → 5 fail; no-parse guard → 1 fails; schema guard → 1 fails. Restored, 14/14.
- **Corpus sweep (AC #13):** 15,972 `.liquid` files across the eight trees, 498 containing an inline body. **15 offenses, exactly 5 distinct messages — the five the description measured, and no others.** Zero false positives.

      0  substrate-large          0  pcbs
     11  tertius                  0  styleseeker
      0  marketplace-tmpl         0  sis
      4  marketplace-dcra         0  cittizen

  `substrate-large` reports **zero**, as the description predicted. The 11/4 split is one codebase counted twice: `tertius` vendors a copy of `marketplace-dcra`, and all five distinct findings live in that copy — `app/lib/commands/v2/payment_methods/assign.liquid`, `app/lib/commands/v2/permits/delete.liquid`, `app/lib/consumers/job_admin_transferred/transfer_objects.liquid`, `app/views/pages/api/job_changes/patch.json.liquid`, `app/views/pages/api/permits/patch.json.liquid`.

## Out of scope, worth its own task

Inline bodies still get **no deprecation check**: `DeprecatedGraphQLField` is GraphQL-typed, and this check runs only graphql-js's default rules. It cannot carry both, because a check has one severity in `meta` and `report()` has no per-offense override — schema invalidity is `ERROR`, a deprecation is `WARNING`. Covering inline deprecations needs a third check. Measured exposure is small: 2 occurrences of `RootQuery.constant` across the eight trees.
<!-- SECTION:NOTES:END -->
