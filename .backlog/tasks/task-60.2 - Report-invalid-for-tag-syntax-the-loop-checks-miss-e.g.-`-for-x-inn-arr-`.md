---
id: TASK-60.2
title: >-
  Report invalid for-tag syntax the loop checks miss (e.g. `{% for x inn arr
  %}`)
status: Done
assignee: []
created_date: '2026-08-05 20:50'
updated_date: '2026-08-05 21:23'
labels:
  - linter
  - bug
dependencies: []
parent_task_id: TASK-60
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during the TASK-60 sweep (2026-08-05): `{% for x inn arr %}x{% endfor %}` produces 0 offenses, but the runtime's lax for-parser requires ` in ` (for.rb Syntax regex) and raises `SyntaxError: errors.syntax.for` at render — a guaranteed production error, currently silent.

Why: `for`/`tablerow` are in `TAGS_WITH_DEDICATED_CHECKS` (InvalidTagSyntax.ts), so the generic catch-all skips them, and the dedicated checks (`detectInvalidLoopRange`, `detectInvalidLoopArguments`) don't handle string-markup fallback caused by a misspelled/missing `in` keyword. Same pattern as the conditional gap fixed in TASK-60: the exemption assumes the dedicated checks cover all fallback shapes, but they don't.

Suggested shape: when a for/tablerow tag's markup fell back to string and the markup does not contain a standalone `in` token, report that the `in` keyword is missing/misspelled (near-miss suggestion for tokens like `inn`, `im` mirrors TASK-60's operator suggestions). Check what other for-markup fallback shapes exist (e.g. junk after the collection) before scoping the message set.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% for x inn arr %}x{% endfor %}` reports one LiquidHTMLSyntaxError offense naming the missing/misspelled `in` keyword
- [x] #2 Valid loops stay silent: `{% for x in arr %}`, `{% for x in (1..5) %}`, loops with limit/offset/reversed arguments
- [x] #3 tablerow gets the same coverage
- [x] #4 Full platformos-check-common suite passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New detectInvalidLoopIn in checks/InvalidLoopIn.ts for for/tablerow tags whose markup fell back to string. Reports when the second token is not the literal `in` keyword: `Expected 'in' after the loop variable, found 'inn'. Did you mean 'in'?` with an autofix replacing the token when it is a near-miss (case-insensitive match or edit distance ≤ 1: inn, IN, im, on); no fix otherwise (e.g. `within`). Prefix-tolerant by design: `for x` and `for x in` stay silent, consistent with InvalidLoopArguments' ≤3-fragments guard for still-being-typed markup. Wired into index.ts gated so InvalidLoopRange/InvalidLoopArguments are skipped when the in-keyword is broken (they would misread everything after it). editDistance moved to checks/utils.ts, now shared with InvalidConditionalNode. 5 tests incl. tablerow and `{% liquid %}` statement form; full monorepo suite green (3059). Note: `limit:`/`reversed` valid-loop cases are asserted in InvalidLoopArguments specs which provide the for-parameter docset — the bare test harness docset has no for params.
<!-- SECTION:FINAL_SUMMARY:END -->
