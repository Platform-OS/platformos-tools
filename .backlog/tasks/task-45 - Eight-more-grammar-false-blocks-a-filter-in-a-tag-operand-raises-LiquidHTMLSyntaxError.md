---
id: TASK-45
title: >-
  Eight more grammar false blocks: a filter in a tag operand raises
  LiquidHTMLSyntaxError
status: Done
assignee: []
created_date: '2026-08-02 18:15'
updated_date: '2026-08-02 22:08'
labels:
  - liquid-html-parser
  - false-block
  - eval-round5
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND5.md
  - packages/liquid-html-parser/grammar/liquid-html.ohm
modified_files:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - packages/liquid-html-parser/src/stage-1-cst.ts
  - packages/liquid-html-parser/src/stage-2-ast.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.spec.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/filters-in-tag-operands.spec.ts
  - packages/platformos-check-common/src/checks/unclosed-html-element/index.ts
  - packages/prettier-plugin-liquid/src/printer/printer-liquid-html.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

A tag operand binds `liquidExpression<delim>`, which excludes `liquidFilter*`. A filter in that position therefore raises `LiquidHTMLSyntaxError` — a BLOCKING check — on code the converter accepts.

Round 2 established the mechanism (N-02) and adjudicated eleven constructs, finding five false blocks. **Seven operands binding `liquidExpression` had never been probed at all.** Round 5 probed them and found eight more.

**Confirmed false-block count goes from five to thirteen.** There is no workaround for the agent: the write gate refuses valid code.

## The eight, each adjudicated by PAIRED dry-run

Each construct was deployed with the filter and again without it, so a rejection caused by a bad fixture is distinguishable from one caused by the filter.

| Construct | linter | `--dry-run` with filter | control (no filter) |
|---|---|---|---|
| `{% cache 'k' \| append: '1' %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% log 'msg' \| upcase %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% yield 'slot' \| upcase %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% redirect_to '/p' \| append: '/x' %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% spam_protection 'x' \| downcase %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% response_headers '…' \| upcase %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% render 'p' with 'a' \| upcase %}` | BLOCKS | ACCEPTED | ACCEPTED |
| `{% render 'p' for 'a,b' \| split: ',' %}` | BLOCKS | ACCEPTED | ACCEPTED |

## Two that the grammar refuses CORRECTLY

| Construct | `--dry-run` with filter | control |
|---|---|---|
| `{% assign x = a['k' \| upcase] %}` | REJECTED | ACCEPTED |
| `{% for i in (1..'3' \| plus: 0) %}` | REJECTED | ACCEPTED |

Index-lookup interiors and range bounds genuinely do not take filters.

## Why the obvious fix is wrong

Moving `liquidVariable` into `liquidExpression` wholesale would convert the four correct `if`/`unless`/`for`/`elsif` refusals into deploy-wide FALSE APPROVALS. Round 2 reached the same conclusion.

**There is still no rule connecting the two groups.** Establishing one — rather than enumerating operands — is the actual work here, and it should be derived from what the converter accepts, not from what looks consistent.

## Method notes

- The Ohm editor at <https://ohmjs.org/editor/> takes `grammar/liquid-html.ohm` directly and shows which rule stops matching. Far better than reasoning backwards from an offset.
- The parser is TWO-STAGE (Ohm CST -> AST). An offense can be correct at CST level and wrong in the AST mapping, so settle which stage each case fails at.
- Both `liquid-html.ohm` and `liquid-html.ohm.js` must be edited together or they silently diverge.
- Round 5 did NOT attack the CST->AST mapping at all; it remains the largest unexamined surface.

## Falsifier

A converter rejection of any of the eight when the filter is present but not when it is absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All eight constructs parse without a diagnostic, matching --dry-run
- [x] #2 The two constructs the converter REJECTS (index-lookup interior, range bound) still block — the fix must not trade false blocks for false approvals
- [x] #3 The four correct if/unless/for/elsif refusals from N-02 are re-verified as still refusing
- [x] #4 A RULE is stated for which operands accept filters and which do not, derived from converter behaviour rather than from grammar symmetry
- [x] #5 Every N-02 and round-5 construct is a fixture, so the adjudication is repeatable rather than a table in a report
- [x] #6 Both grammar files are updated together and asserted not to diverge
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Adjudicated independently — the round-5 table is incomplete in BOTH directions

Every construct re-measured with paired `pos-cli deploy --dry-run` (filter present, then absent) so a rejection caused by a fixture is distinguishable from one caused by the filter.

**Three more false blocks than reported — 11, not 8.** `case`, `when` and `cycle` also refuse filters the converter accepts; round 5 never probed them. Also confirmed accepting: `render`/`function` named-argument values, hash-pair values, `session`.

**Three FALSE APPROVALS the report scored as correct refusals.** Round 5 listed if/unless/elsif as "correctly refused". They are not refused at all:

| construct | supervisor | converter |
|---|---|---|
| `{% if 'a' \| upcase == 'A' %}` | block=false, 0 diagnostics | REJECTED |
| `{% unless 'a' \| upcase == 'A' %}` | block=false, 0 diagnostics | REJECTED |
| `{% if false %}{% elsif 'a' \| upcase == 'A' %}` | block=false, 0 diagnostics | REJECTED |
| `{% if 'a' \| upcase %}` | block=true | REJECTED |

A converter rejection fails the WHOLE changeset, so these were the more dangerous half.

**`for … in` is refused, and the report does not cover it.** Round 5 listed `{% for i in (1..'3' \| plus: 0) %}` — a RANGE BOUND. The plain `in` operand is a different grammar position and is also refused. Two separate facts that are easy to conflate.

## Two corrections to my own diagnosis, recorded because both were confident and wrong

1. I first concluded "the grammar parses these fine, the block comes from a check". WRONG. The parser is TOLERANT: when a known tag's strict markup rule fails it does not throw, it stores markup as a raw STRING, and `InvalidTagSyntax` reports that. I mistook tolerance for acceptance. Verified by inspecting `typeof node.markup` — `'k' | append: '1'` comes back as a string, `'k'` comes back parsed. The round-5 cause attribution was right.

2. The runtime is NOT a usable oracle here. `liquid_exec` accepted EVERY construct, including the four the converter rejects — verified with controls proving it does report real syntax errors. For a syntax question the converter is the only authority, exactly as the methodology's "O1c outranks O1a for syntax" rule says.

Also hit the fixture trap directly: the first adjudication harness used `|` as its field delimiter, which shredded every fixture containing a filter. Every control "failed", which is what exposed it.

## The rule (AC#4), derived from converter behaviour

Filters are accepted wherever the platform parses a full Liquid **Variable**, and refused wherever it parses a bare **Expression**:

| accepts filters | refuses filters |
|---|---|
| cache key, log message, yield, redirect_to, spam_protection, response_headers, render `with`/`for`, case subject, when, cycle, named-argument values, hash-pair values, session | index-lookup interior, range bounds, condition operands (if/unless/elsif, both sides of a comparison), `for … in` source |

This is not derivable from grammar symmetry — it follows the Ruby tag's own markup parsing.

## DELIVERED this pass: the false approvals

`InvalidConditionalNode` gained `checkFilterInCondition`, running FIRST so the specific explanation beats the general heuristics.

Why it was needed: `|` classified as a plain `variable` token, and `checkLaxParsingIssues` treats "variable followed by an operator" as a legitimate unknown operator — so every comparison form slipped through. Only the truthy form was caught, by accident, with a message about truthiness that never mentioned filters.

- `|` and `||` are distinct tokens (measured), so `||` still gets its own "use and/or" message.
- NO autofix, deliberately: the repair needs an `{% assign %}` on a preceding line, which the corrector cannot express, and dropping the filter would silently change what the condition tests. `ExpressionIssue.fix` is now optional.

**An existing test asserted the opposite** — that `{% if wat | something == something %}` produces no offense. Its exact shape was measured first (variable AND literal, real AND unknown filter name; all rejected) before being rewritten to the measured behaviour.

Sabotage: rule removed -> 2 fail; `||` conflated with `|` -> 2 fail; rule ordered last -> 2 fail (the first attempt at this one was mis-targeted and re-run properly).

## STILL OPEN: the 11 false blocks, and why they were not done here

The honest fix spans FIVE layers per position — `.ohm` + `.ohm.js`, stage-1 CST (positional child indices shift), stage-2 AST types, and the prettier printer.

That last one is a data-loss trap, measured rather than assumed:

```
today:  {% cache 'k' | append: '1' %}  ->  {% cache 'k' | append: '1' %}   (unchanged)
```

The markup is a raw string today, and the printer emits raw strings verbatim, so formatting preserves it. Once the markup PARSES into `CacheMarkup { key, args }` and the printer is not taught about filters, format-on-save would emit `{% cache 'k' %}` and delete the filter from the author's file — silently, with no error. A false block is loud and recoverable; a formatter that eats code is not.

So the grammar, both CST/AST stages and the printer must land together. `ohm-js` is already a dependency, so the grammar half can be asserted programmatically in CI rather than only in the online Ohm editor.

## Verification for this pass

322 test files / 3173 tests pass, type-check clean, prettier clean, build clean.

## DELIVERED this pass: the 11 false blocks

The five-layer fix landed together, exactly as the previous pass said it had to.

**Grammar.** One new rule pair, swapped into the ten operands that accept filters:

```ohm
liquidFilteredExpression<delim> =
  | liquidExpressionWithFilters<delim>
  | liquidExpression<delim>

liquidExpressionWithFilters<delim> = liquidExpression<delim> liquidFilter<delim>+
```

`liquidFilter+`, NOT `liquidFilter*` — measured, not chosen. With `*` the filterless form still matches the first alternative and every operand gets wrapped in a `LiquidVariable`, which broke 22 stage-2 and 12 stage-1 assertions. With `+` the alternation falls through to the bare expression and the change costs ZERO fixture edits. The refusing positions (conditions, `for … in`, range bounds, index-lookup interiors) were left binding `liquidExpression`, so AC#2 and AC#3 hold by construction rather than by a guard.

**Stage 1** maps `liquidExpressionWithFilters` onto the existing `ConcreteLiquidVariable` shape — the same node `{{ }}` and `{% assign %}` already produce.

**Stage 2** gained `FilteredLiquidExpression = LiquidExpression | LiquidVariable` and `toFilteredExpression`, applied to exactly the ten widened operands. Widening `toExpression` itself was tried first and cascaded into ~20 unrelated consumers; scoping it to the new helper keeps the blast radius at the operands that actually changed.

**Printer — the data-loss trap is closed.** Because the wrapper reuses the SAME `LiquidVariable` the printer already prints, all eleven constructs round-trip through `prettier-plugin-liquid` unchanged. Fixing this also surfaced a PRE-EXISTING crash: `SpamProtectionMarkup` printed `path.call(…, 'value')` against a node whose field is `version`, so the printer threw on EVERY `spam_protection` tag, filter or not. Fixed.

**LSP delta is zero by construction** — no language-server file is touched, and the widened types are accepted where they were previously refused.

## AC#6 rested on a false premise — corrected

"Both grammar files are updated together and asserted not to diverge" cannot be done and does not need to be. `grammar/liquid-html.ohm.js` is **gitignored** (`packages/liquid-html-parser/.gitignore:7`) and **generated** from the `.ohm` source by `build/shims.js` on `prebuild:ts`. There is one grammar file under version control; divergence is not a reachable state. An early attempt to hand-regenerate the `.js` produced a corrupt file, which is how this was found. AC#6 is satisfied by the generation step, not by an equality assertion.

## Fixtures (AC#5)

`filters-in-tag-operands.spec.ts` pins the whole adjudication: 11 accepted operands, 10 filterless CONTROLS (a grammar change wide enough to accept anything would satisfy the first group alone), and 6 that must keep blocking.

## Verification

Full suite green after a clean rebuild: **323 test files / 3192 tests, exit 0**; `yarn build` 0 errors; `format:check` clean.

One earlier full run reported 22 failures in `stage-2-ast.spec.ts` and one other file. Diagnosed rather than assumed: it ran against stale generated grammar artefacts — the same specs pass in isolation and pass in the full suite after `yarn build`. Nothing was changed to make them pass.
<!-- SECTION:NOTES:END -->
