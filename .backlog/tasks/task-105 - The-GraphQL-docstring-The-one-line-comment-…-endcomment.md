---
id: TASK-105
title: >-
  The gate approves GraphQL descriptions and unclosed comment/raw/doc blocks —
  ten shapes the converter rejects
status: Done
assignee: []
created_date: '2026-09-05 15:57'
updated_date: '2026-09-07 07:58'
labels:
  - platformos-common
  - liquid-html-parser
  - false-approval
  - measured
dependencies: []
priority: high
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Filed from an agent session that hit both while building an app. Both are FALSE APPROVALS: `validate_code` returned `status: "ok"`, `must_fix_before_write: false` and `impact: "computed"`, and the deploy converter then refused the changeset.

## As reported

**1. The GraphQL `"""docstring"""`.** Each stored read query opened with a block string describing it. Five files came back clean; the deploy died before uploading anything, every position pointing at the `query` keyword on the line after the closing `"""`. Control: the three files in the same directory WITHOUT a docstring were the only ones that did not error, isolating the docstring as the cause. Reported mechanism: GraphQL has two grammars, and the executable one has no description production.

**2. The one-line `comment … endcomment` inside `{% liquid %}`.** Clean from `validate_code`; `Body syntax is invalid (Liquid syntax error: 'comment' tag was never closed)` from the deploy. Reported mechanism: inside `{% liquid %}` each line is one tag invocation, so `comment` takes the rest of the line — trailing `endcomment` included — as its markup, then scans following lines for a closer and never finds one. The reporter flagged that the behaviour was measured but the mechanism was `[inferred]`, and that the same error message also arises from an unrelated known cause (a `%}` inside comment prose), so a reader who checks for delimiters and finds none is otherwise stuck.

## Measured (2026-09-07)

Both mechanisms confirmed, both reported messages reproduced verbatim. Both defects are OURS — the platform is behaving correctly in every case and needs no change.

Root cause is the same shape twice: we and the platform parse the same format with different libraries and nobody ran the differential.

| format | platformos-tools runs | the platform runs |
|---|---|---|
| GraphQL | npm `graphql` 16.14.2 (graphql-js) | `graphql` 2.6.3 + **`graphql-c_parser` 1.1.3** |
| Liquid | `liquid-html-parser` (Ohm) | Shopify `liquid` 5.11.0 (git main `d897899`), `error_mode: :strict` |

A 50-case executable-GraphQL differential and a 21-case Liquid differential found **12 divergences, every one in the same direction — we approve, the converter rejects**. Ten are in scope here, and the SELF-REVIEW below widened two of them after measuring positions the first corpus never probed (G4 and L3), so read those two rows as corrected rather than as first filed:

| # | shape | our verdict | converter |
|---|---|---|---|
| G1 | `"""d"""` before `query` / `mutation` / `subscription` *(as reported)* | silent | rejects |
| G2 | `"""d"""` before `fragment` | silent | rejects |
| G3 | description on a variable definition — `query q("the id" $id: ID!)` | silent | rejects |
| G4 | a UTF-8 BOM ANYWHERE in the file (six positions measured, not just the front) | silent | rejects |
| L1 | `comment … endcomment` on one line inside `{% liquid %}` *(as reported)* | silent | rejects |
| L2 | `{% comment %}` never closed | silent | rejects |
| L3 | `raw` used at all inside `{% liquid %}`, at ANY nesting depth — its closer is never a bare line | silent | rejects |
| L4 | `{% raw %}` never closed | silent | rejects |
| L5 | `{% doc %}` never closed | silent | rejects |
| L6 | `doc … enddoc` on one line inside `{% liquid %}` | silent | rejects |

**GraphQL root cause.** graphql-js 16 ships the operation-descriptions proposal UNCONDITIONALLY — `parseOperationDefinition` calls `parseDescription()`, and `ParseOptions` has no flag to disable it. So this is not a missing validation; it is graphql-js implementing a proposal the platform's parser does not.

**Liquid root cause.** `liquid-html-parser` models a CLOSED `comment`/`raw`/`doc` block as a `LiquidRawTag`. When the block rule fails, the tolerant parser falls back to a base-case `LiquidTag` of that name — and `RAW_CONTENT_TAGS = ['comment','raw','doc']` (`grammar.ts:107`) is exactly the set `InvalidTagSyntax` exempts, because for a properly closed raw tag the empty markup IS correct. The exemption is right for its own purpose and swallows the failure case with it. A `LiquidTag` (not `LiquidRawTag`) with one of those three names can only arise from a block that never closed.

Our parser already reports the other 13 block tags correctly; the report happened to land on the silent family.

**Measured non-divergences**, so nobody "fixes" them later: `{% comment junk %}…{% endcomment %}` — both accept (markup on `comment` is legal, on `raw` it is not); `content_for`/`background`/`graphql` one-liners are reported, but by accident (their inline markup rule fails); stray `{% endcomment %}`/`{% endraw %}` — both reject with identical wording.

## Oracles

- `pos-cli deploy --dry-run` against a live instance. Authoritative here: both defects are ActiveModel validations (`GraphqlQueryValidator`, `LiquidValidator`), which run inside `collect_validation_errors` and so ARE reached by a dry run — unlike the nested-converter classes in N3 of `UPSTREAM-ISSUES-VERIFIED.md`.
- `graphql-c_parser` 1.1.3 and `liquid` 5.11.0 installed locally — byte-identical messages to the converter.
- `platformos-check-node/dist/cli.js` on temp projects, each fixture paired with a control proving it is lintable.

Note for whoever re-runs this: the PURE-RUBY graphql 2.6.3 parser is NOT the platform's parser and gives different answers (it accepts `{ a { } }`, the C parser rejects it). Measuring without loading `graphql-c_parser` produces a wrong oracle. Same class of mistake as the Psych/safe_yaml one in CLAUDE.md.

## Not in this task

- Float exponent with no fraction (`1e3`) — separate task. Low, and the one genuinely upstream finding: `1e3` is a valid `FloatValue` per the GraphQL spec and `graphql-c_parser` rejects it.
- `{% raw markup %}` — separate task. Low, and it must NOT be fixed in the parser: `prettier-plugin-liquid/src/test/liquid-tag-no-argument/` exists to assert the printer STRIPS that argument, which needs the parser to stay tolerant.

Related but distinct: TASK-80 covers a statement whose MARKUP rule fails inside a `{% liquid %}` body. This one is about block CLOSURE. Same false-approval family, different mechanism; neither subsumes the other.

Priority raised from Medium to High on the measurement: L2 is a plain forgotten `{% endcomment %}` and G1 is an ordinary thing to write when documenting a stored operation, and either fails the WHOLE changeset rather than one file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A description on an operation, a fragment definition, or a variable definition makes `parseGraphql` return a syntaxError and no document, and `GraphQLCheck` reports it (G1-G3)
- [x] #2 A leading UTF-8 BOM in a `.graphql` file does the same (G4)
- [x] #3 CONTROL: a description on a TYPE-SYSTEM definition is still accepted — both parsers take it, and a fix wide enough to catch G1-G3 can easily refuse valid SDL
- [x] #4 VERIFY (not assumed): a `.graphql` file rejected by the new rule still reports `impact: computed`. A GraphQL document is a graph leaf, but that is about OUTGOING edges and impact is about incoming ones — measure it rather than reason from `types.ts:131`
- [x] #5 `comment`, `raw` and `doc` blocks that do not close where the platform requires produce `LiquidHTMLSyntaxError`, in both the `{% %}` form and the `{% liquid %}` body form (L1-L6)
- [x] #6 CONTROL: `{% comment junk %}…{% endcomment %}` still parses — the platform accepts markup on `comment`, so refusing it would be a new false rejection
- [x] #7 Every existing prettier fixture still formats. Measured: no fixture currently holds an unbalanced comment/raw/doc, so this should hold — confirm rather than assume
- [x] #8 The 50-case GraphQL and 21-case Liquid differential corpora are re-run against `graphql-c_parser` 1.1.3 and `liquid` 5.11.0, and the divergence count for the ten in-scope shapes is zero
- [x] #9 Each new rule is sabotaged by hand and the intended test — and only it — fails
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `platformos-common/src/graphql/parse.ts` — parse with graphql-js, then reject what the platform's parser will not take, returning `syntaxError` and no `document`. That is the literal truth (the platform has no parse of the file) and it is what every consumer already reads "did not compile" from: `extractGraphqlVariables` returns `undefined` (distinct from `[]`), `extractGraphqlTables` returns `[]`, `GraphQLVariablesCheck` returns silently, and `GraphQLCheck` reports through its existing syntax-error branch. `GraphQLCheck` is already in `BLOCKING_CHECKS`, so this blocks with no supervisor change.
2. `liquid-html-parser` stage 2 — a `LiquidTag` (not `LiquidRawTag`) named `comment`/`raw`/`doc` can only be the fallback for a block whose closer was not found, so raise `LiquidHTMLSyntaxError` there. One rule covers L1-L6 and both syntactic contexts, and the message matches the runtime's wording, as the other 13 block tags already do.
3. Specs on both sides, every expectation taken from the measured corpora rather than from the spec documents.
4. Re-run both differential corpora; then the full suite, type-check and prettier.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

**`platformos-common/src/graphql/parse.ts`** — `parseGraphql` parses with graphql-js, then rejects what `graphql-c_parser` will not take, returning `syntaxError` with no `document`. Covers a description on an operation / fragment definition / variable definition, and a leading BOM. A description on a type-system definition is left alone.

**`liquid-html-parser/src/stage-2-ast.ts`** — two guards:

- `assertRawContentTagClosed`, in `toLiquidTag`. A CLOSED `comment`/`raw`/`doc` becomes a `LiquidRawTag`, so arriving on the ordinary tag path means the block rule did not match. Covers both syntactic contexts at once.
- `assertUsableInsideALiquidTag`, on the `{% liquid %}` body. `LiquidStatement` has a bare-line `raw`…`endraw` spelling that Liquid does not, so that one parses as a closed raw tag and needs its own rejection.

Both obey `allowUnclosedDocumentNode`, the switch every other unclosed block already answers to in `cstToAst` — so `toLiquidAST` stays tolerant of these exactly as it is of `{% if %}`. `RAW_CONTENT_TAGS` was exported from `grammar.ts` rather than duplicated, with a note that its two readers are two sides of one fact.

## Corrections made while implementing

- The first version of the second guard listed `['raw', 'doc']`. `doc` is unreachable there — `liquidDocStart`/`liquidDocEnd` exist only in the `{%`-delimited grammar, so inside `{% liquid %}` a `doc` never matches a raw rule and reaches the first guard instead. Narrowed to `raw`, rather than ship a branch no input can reach and no test can kill.
- The guards originally ignored `allowUnclosedDocumentNode`, which would have made these three tags throw under `toLiquidAST` while `if` and `for` stayed quiet. Caught by reading `cstToAst`, not by a failing test — so a test now pins it.

## Verification

- Sabotage, 5 rules, each reverted after: whole GraphQL rule off → 8 fail; BOM branch only → 1; variable-description branch only → 1; base-case Liquid guard off → 7; liquid-body raw guard off → 1; each flag check → 4 and 1. Every one failed the intended tests and only those.
- Differentials re-run against `graphql-c_parser` 1.1.3 and `liquid` 5.11.0, driving `parseGraphql` and `toLiquidHtmlAST` rather than the underlying libraries: GraphQL **1 divergence of 50**, Liquid **1 of 21**. Both survivors are the deliberately excluded ones — TASK-108 (`1e3`) and TASK-109 (`{% raw markup %}`). In-scope divergences: **0**.
- AC#4 MEASURED rather than reasoned: `runValidateCode` on a temp project where a page calls the query. Baseline `status=ok / must_fix=false / impact=computed`; the described query and the BOM file both `status=error / must_fix=true / impact=computed`. Impact survives the rejection, and the write is blocked — the exact reversal of the reported `ok / false / computed` followed by a deploy rejection.
- The two files from the original report re-checked against `pos-cli deploy --dry-run`: still refused by the converter, now refused by the gate first.
- `transport/instructions.ts` needs no edit — it makes no claim about either shape, only the general "call validate_code before writing GraphQL". Checked rather than assumed.
- Prettier plugin suite green (89 files, 146 tests), which is AC#7.

## Self-review (2026-09-07, after the first pass was called done)

The first pass was NOT flawless. Two real defects in the fix itself, both from testing one representative case rather than the space around it, and both found by measuring shapes the first round never probed.

**1. The BOM check only looked at position 0.** `content.charCodeAt(0) === 0xfeff`. The platform's lexer refuses a BOM at ANY position — measured at six (front, after a newline, after a comment, between definitions, inside a selection set, at end): 5 of the 6 passed the gate. Now `content.indexOf`, reported at the real index. Sabotage: narrowing it back fails exactly those 5 and leaves the leading one green.

**2. The `{% liquid %}` raw guard only scanned TOP-LEVEL statements.** A `raw` nested in an `if` or a `case` is a child of that block and never appears in the body's statement list, so it was missed — measured against `liquid` 5.11.0. This was the exact gap suspected and not checked in round one.

Fixed by REDESIGN rather than by patching the scan: `insideLiquidTag` is threaded through the single `cstToAst` call that builds the body, and the question is asked per node in the `LiquidRawTag` case. That reaches every depth by construction instead of by enumerating nesting shapes. `assertUsableInsideALiquidTag` became `assertRawTagUsableHere`.

**Three concerns checked and cleared** rather than assumed:

- Both language-server parse paths (`LiquidCompletionParams.parsePartial`, `HtmlElementAutoclosingOnTypeFormattingProvider.nodeAtCursor`) pass `allowUnclosedDocumentNode: true`, so a half-typed `{% comment %}` does not kill completions. This is what retroactively justifies threading that flag — without it, completions would have broken.
- `.unclosed` has exactly one consumer and it is gated on `NodeTypes.HtmlElement`, so throwing without that payload is safe.
- Description POSITIONS were already complete: a second variable definition, a description after an SDL definition, a second fragment — all three already caught.

**Process note.** The first sabotage of the BOM change was a silent no-op: a perl pattern that never matched the BOM literal, so the run reported 23 passed and proved nothing. Caught from the unchanged `grep` output, redone in python. A sabotage that does not change the file is indistinguishable from a test that does not bite.

**After the fixes:** both gap corpora 0 divergent; the original corpora unchanged at 1/21 and 1/50 (only TASK-108 and TASK-109), so no regression. 11 new cases. Full monorepo suite 4567 tests across 357 files. Type-check and prettier clean. Comments trimmed across all five files on request — net −89 lines against the +90 the first pass added.

**Known uncovered, stated rather than papered over:** an INLINE `{% graphql %}…{% endgraphql %}` body carrying a description is not checked. Reading `GraphqlTag#render_to_output_buffer`, an inline body goes through `PartialCache` at render time, which makes it a runtime failure rather than a deploy rejection — but that is a source read, NOT a measurement, and it was not probed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ten shapes that passed the gate and then failed the deploy are now reported. Both were the same mistake — the same format parsed by two different libraries, with no differential ever run between them.

The two shapes in the report turned out to be 2 of 12 measured divergences, all one-directional: we approved, the converter refused. Ten are fixed here; the other two are TASK-108 and TASK-109, excluded for reasons recorded on each.

**`platformos-common/src/graphql/parse.ts`** — `parseGraphql` now rejects a description on an operation, a fragment definition or a variable definition, and a leading BOM, returning `syntaxError` with no `document`. graphql-js 16 ships the operation-descriptions proposal unconditionally and offers no flag to disable it, so this could not be a parser option. Descriptions on type-system definitions are untouched.

**`liquid-html-parser/src/stage-2-ast.ts`** — `assertRawContentTagClosed` in `toLiquidTag` catches `comment`/`raw`/`doc` blocks that never closed, in both syntactic contexts; `assertUsableInsideALiquidTag` catches `raw` inside `{% liquid %}`, which this grammar has a bare-line spelling for and Liquid does not. Both obey `allowUnclosedDocumentNode`, so `toLiquidAST` stays as tolerant of these as it is of `{% if %}`.

Two corrections made during implementation, both from reading rather than from a failing test: an unreachable `doc` entry in the second guard was removed rather than shipped as a branch no test could kill, and the guards initially ignored `allowUnclosedDocumentNode` — a test now pins that.

**Verified.** Five sabotages, each failing its intended tests and only those. Both differential corpora re-run against `graphql-c_parser` 1.1.3 and `liquid` 5.11.0, driving `parseGraphql`/`toLiquidHtmlAST`: GraphQL 1 divergence of 50, Liquid 1 of 21, both being the deliberately excluded shapes — zero in-scope. Through the supervisor, the described query and the BOM file come back `must_fix=true` with `impact` still `computed`, against a clean `ok/false/computed` baseline: the exact reversal of the reported failure. Full monorepo suite 4567 tests across 357 files, type-check and prettier clean. A later self-review found and fixed two defects in this fix — see the Implementation Notes; the numbers here are post-review.

Left in the working tree, uncommitted, on `fix/the-gate-approves-graphql-descriptions-and-unclosed-raw-blocks`, with a changeset.
<!-- SECTION:FINAL_SUMMARY:END -->
