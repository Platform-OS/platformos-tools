---
id: TASK-82
title: >-
  Autofix silently changes the value of an operator expression in assign and
  echo — report without fixing
status: Done
assignee: []
created_date: '2026-08-22 15:21'
updated_date: '2026-08-22 15:32'
labels:
  - bug
  - platformos-check
  - correctness
  - data-loss
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
modified_files:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/utils.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/MultipleAssignValues.ts
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidEchoValue.ts
priority: high
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`LiquidHTMLSyntaxError`'s autofix rewrites a Liquid expression the platform rejects into a *different, valid* program, and reports success. Running `pos-cli check run -a` on:

```liquid
{% assign x = flag ? 'yes' : 'no' %}
```

produces `{% assign x = flag %}`, prints "No offenses found", and the rewritten file passes `deploy --dry-run` clean. `x` is now `true` — neither `'yes'` nor `'no'`.

This is the highest-severity failure class in the toolchain: silent corruption of the author's file, triggered by a command universally believed safe, with no error at any layer afterwards. The converter rejection that was the last line of defence is removed *by the linter*.

## Measured scope (live instance + check harness, 2026-08-22)

Both `detectMultipleAssignValues` and `detectInvalidEchoValue` take the first value in the markup and delete everything after it. Every construct below is a converter rejection today (`deploy --dry-run`, exit 1), so the fix converts a REJECTED file into an ACCEPTED one by deleting meaning:

| Source | Autofix produces | Safe? |
|---|---|---|
| `{% assign x = flag ? 'yes' : 'no' %}` | `{% assign x = flag %}` | NO |
| `{% assign x = a && b %}` | `{% assign x = a %}` | NO |
| `{% assign x = a and b %}` | `{% assign x = a %}` | NO |
| `{% assign x = 1 + 2 %}` | `{% assign x = 1 %}` | NO |
| `{% assign x = a == b %}` | `{% assign x = a %}` | NO |
| `{% assign x = a ? b : c \| upcase %}` | `{% assign x = a \| upcase %}` | NO |
| `{{ flag ? 'yes' : 'no' }}` | `{{ flag }}` | NO |
| `{% echo flag ? 'yes' : 'no' %}` | `{% echo flag %}` | NO |
| `{% liquid echo a ? b : c %}` | `{% liquid echo a %}` | NO |
| `{% assign foo = '123' 555 text %}` | `{% assign foo = '123' %}` | yes |
| `{% assign foo = 'a?b' 555 %}` | `{% assign foo = 'a?b' %}` | yes |
| `{% assign foo = -5 555 %}` | `{% assign foo = -5 %}` | yes |
| `{% assign foo = (1..3) 555 %}` | `{% assign foo = (1..3) %}` | yes |

The safe rows are stray tokens with no meaning; the platform's lax parser resolves them to the first value too (measured: `{% assign foo = '123' 555 text %}` renders `123`), so the fix is behaviour-preserving there and must be kept.

## Why the distinction is real

The deleted text in the unsafe rows is an operand of an expression the author wrote. Reproducing the lax parser's "take the first value" is correct when the remainder is junk and wrong when the remainder is intent.

The same reasoning is already recorded in `MultipleAssignValues.ts` for `UnsupportedStringEscape`: *"this fix would DELETE it, making the truncation permanent."* This is that argument applied to operator expressions.

## Constraint

The offense must keep firing. `LiquidHTMLSyntaxError` is in the supervisor's `BLOCKING_CHECKS`, and that block is the only thing standing between this syntax and a silent wrong value at runtime. Only the *fix* is withheld; severity, message and position are unchanged.

## Out of scope, verified separately

`InvalidFilterName` and `InvalidPipeSyntax` also delete text, but their deleted region is malformed filter syntax (a stray comma, trailing characters after a filter name) rather than an operand, so they do not share this hazard.

## References

`UPSTREAM-ISSUES-VERIFIED.md` §N5 carries the reproduction and the platform measurements.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An assign whose value section contains an operator (`?`, `:`, `&&`, `||`, `and`, `or`, `contains`, `==`, `!=`, `<`, `>`, `<=`, `>=`, `+`, `-`, `*`, `/`) is still REPORTED with the same message, severity and position, and carries NO fix
- [x] #2 An echo tag, a `{% liquid echo %}` statement and a `{{ }}` output whose value section contains an operator are still REPORTED and carry NO fix
- [x] #3 Stray-token cases keep their fix and their exact fixed output: `'123' 555 text`, `'a?b' 555`, `-5 555`, `(1..3) 555`, and the filtered variants already covered by the suite
- [x] #4 A quoted value containing `?` or `:` is not mistaken for an operator, so it keeps its fix
- [x] #5 Every must-stay-silent (no-fix) case is paired with a control in the same test that must still report, so a suppression that swallowed the offense fails the suite
- [x] #6 The operator predicate is unit-tested in isolation against both operator and value tokens, including `-5` versus a bare `-`
- [x] #7 Deliberately reverting the guard makes the new tests fail (sabotage-verified), and the result is recorded
- [x] #8 A changeset accompanies the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add `hasExpressionOperator(valueSection)` to `checks/utils.ts` — token-level, quote-aware, scanning the whole value section rather than only the deleted tail, so an operator in first position is caught too.
2. Gate the `fix` in `detectMultipleAssignValues` on it; report unchanged.
3. Gate the `fix` in `detectInvalidEchoValue` on it (covers `{% echo %}`, `{% liquid echo %}` and `{{ }}`); report unchanged.
4. Unit-test the predicate in `utils.spec.ts`: operator tokens, value tokens, `-5` vs bare `-`, quoted `?`/`:`.
5. Extend both check specs with must-report-without-fix cases, each paired with a must-still-fix control in the same test.
6. Run the full `platformos-check-common` suite; sabotage the guard and confirm the new tests fail.
7. Changeset.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What the investigation changed about the plan

The plan assumed one hazard in two detectors on raw string markup. A **third** detector owns most of the operator forms and was missed by the first pass: `detectInvalidBooleanExpressions` fires on a parsed `BooleanExpression` node, which is why `a == b`, `a and b`, `a or b`, `a contains b` and `a >= b` never reach the token-level guard — the parser turns them into a node instead of leaving raw markup. The first test run caught this by failing on exactly those inputs.

That detector needed a different treatment, not the same guard. Its node is by construction an author-written comparison or logical expression, so it has no stray-token case to protect and its fix is removed outright rather than gated.

**Its existing spec asserted the corruption was correct** (`{% assign foo = something == else %}` → `{% assign foo = something %}`, and three more), so that expectation was replaced rather than extended. A test that pins a defect is the reason the defect survived.

## Boundary, measured rather than assumed

`{% assign x = a || b %}` is owned by `InvalidPipeSyntax` (`||` reads as two pipes) and is deliberately left alone: its repair yields `{% assign x = a | b %}`, which the converter still REJECTS — "Unknown filters: b" — and `UnknownFilter` is itself blocking, so that path cannot fail silently. Pinned as a test so it reads as a decision.

`InvalidFilterName` and `InvalidPipeSyntax` also delete text, but their region is malformed filter syntax rather than an operand; checked and excluded.

## Sabotage results (AC #7)

Each guard reverted in isolation, against the three affected spec files (46 tests):

| Sabotage | Result |
|---|---|
| A — assign guard reverted (`if (true)`) | 6 failed |
| B — echo guard reverted (`if (true)`) | 5 failed |
| C — boolean-expression fix restored | 8 failed |
| D — `isOperatorToken` returns `false` always | 13 failed |
| restored | 46 passed |

## Verification

- `platformos-check-common`: 1757 passed (102 files)
- `platformos-mcp-supervisor`: 469 passed (21 files) — the check is in `BLOCKING_CHECKS`, so its gate behaviour is pinned there
- `yarn type-check` across the monorepo: clean
- Prettier: clean

End to end through the real CLI, after `yarn build`, on the original reproduction:

```
$ pos-cli check run -a
✖  LiquidHTMLSyntaxError   Syntax is not supported
   4  {% assign x = flag ? 'yes' : 'no' %}x=[{{ x }}]
7 offenses found in 3 files    ✖ 2 errors  ⚠ 5 warnings

ternary.liquid      {% assign x = flag ? 'yes' : 'no' %}    UNCHANGED
comparison.liquid   {% assign foo = something == else %}    UNCHANGED
stray.liquid        {% assign foo = '123' %}                still repaired (control)

$ pos-cli deploy staging --dry-run -p
views/pages/ternary.liquid: Content syntax is invalid (Liquid syntax error:
Expected end_of_string but found question…)      exit 1
```

Before this change the same command rewrote the file to `{% assign x = flag %}`, printed "No offenses found", and that file deployed clean.

## Follow-ups deliberately not taken

- The message stays `Syntax is not supported`. A ternary deserves a targeted message naming `{% if %}/{% else %}`, but that is a messaging change with pinned assertions in the supervisor and belongs in its own task.
- `{% assign x = a and b %}` exposed a pre-existing whitespace artifact in the assign fix (`{% assign x = a%}`, losing a space). It is unreachable now — every input that produced it is fix-less — so it was left alone rather than touched speculatively.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`LiquidHTMLSyntaxError` no longer rewrites a Liquid expression into a different, valid program.

Three detectors repaired unsupported markup by keeping the first value and discarding the rest, which reproduces platformOS's lax parser (measured: `{% assign foo = '123' 555 text %}` renders `123`). That is a repair when the tail is stray tokens and a silent rewrite when it is an operand. Because the converter REJECTS the original and ACCEPTS the rewrite, `pos-cli check run -a` traded a whole-changeset failure for a page rendering a value nobody wrote — and printed "No offenses found".

- `detectMultipleAssignValues` and `detectInvalidEchoValue` (raw string markup) withhold the fix when the value section contains an operator, via a new quote-aware `hasExpressionOperator` in `checks/utils.ts`. `'a?b'` and `-5` stay repairable; a bare `-` and a fused `?b` do not.
- `detectInvalidBooleanExpressions` (parsed node) has no repairable case at all, so its fix is removed outright.

Message, severity and position are unchanged — the offense is the mitigation, since the check is in the supervisor's `BLOCKING_CHECKS` and is the only thing between this syntax and a wrong value at runtime.

The cross-detector contract lives in `operator-expressions-are-never-rewritten.spec.ts`, where every must-not-rewrite case is paired with a control the fix must still repair, plus the `||` boundary owned by `InvalidPipeSyntax`. `isOperatorToken` / `hasExpressionOperator` are unit-tested in `utils.spec.ts`. Four independent sabotages each break the new tests.
<!-- SECTION:FINAL_SUMMARY:END -->
