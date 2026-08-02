---
id: TASK-45
title: >-
  Eight more grammar false blocks: a filter in a tag operand raises
  LiquidHTMLSyntaxError
status: To Do
assignee: []
created_date: '2026-08-02 18:15'
labels:
  - liquid-html-parser
  - false-block
  - eval-round5
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND5.md
  - packages/liquid-html-parser/grammar/liquid-html.ohm
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
- [ ] #1 All eight constructs parse without a diagnostic, matching --dry-run
- [ ] #2 The two constructs the converter REJECTS (index-lookup interior, range bound) still block — the fix must not trade false blocks for false approvals
- [ ] #3 The four correct if/unless/for/elsif refusals from N-02 are re-verified as still refusing
- [ ] #4 A RULE is stated for which operands accept filters and which do not, derived from converter behaviour rather than from grammar symmetry
- [ ] #5 Every N-02 and round-5 construct is a fixture, so the adjudication is repeatable rather than a table in a report
- [ ] #6 Both grammar files are updated together and asserted not to diverge
<!-- AC:END -->
