---
id: TASK-60.1
title: 'Report ignored junk in when-branch markup (e.g. `{% when 1 huh 2 %}`)'
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
Found during the TASK-60 sweep (2026-08-05): `{% case var %}{% when 1 huh 2 %}x{% endcase %}` produces 0 offenses, but the runtime's lax `when` parser (WhenSyntax regex in the fork's case.rb) matches only the leading `1` and silently ignores `huh 2` — the branch behaves as `when 1` with no error anywhere.

Why it is currently unreachable: the LiquidBranch visitor in `liquid-html-syntax-error/index.ts` only runs `detectInvalidConditionalNode` (if/elsif/unless names), and `when` is listed in `TAGS_WITH_DEDICATED_CHECKS` in `InvalidTagSyntax.ts` — exempted from the catch-all — even though no dedicated check actually covers it.

Implementation constraint discovered up front: `getValuesInMarkup` strips commas, so the invalid `1 huh 2` and the VALID `1, huh, 2` (comma-separated when values) tokenize identically. Detection must inspect the raw markup with comma/`or` separator awareness, not just the token list. Valid `when` markup is values separated by `,` or `or` (grammar rule `liquidTagWhenMarkup`, whenMarkupSep in liquid-html.ohm).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% case var %}{% when 1 huh 2 %}x{% endcase %}` reports one LiquidHTMLSyntaxError offense saying the junk after `1` is ignored
- [x] #2 Valid separators stay silent: `{% when 1, 2 %}`, `{% when 1 or 2 %}`, `{% when 'a', 'b' or 'c' %}`
- [x] #3 Statement form inside `{% liquid %}` blocks is covered
- [x] #4 Full platformos-check-common suite passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New detectInvalidWhenMarkup in checks/InvalidWhenMarkup.ts, wired into the LiquidBranch visitor after the conditional check. It scans the RAW markup (not tokens, which strip commas) with a value/separator regex walk mirroring the runtime's WhenSyntax reader: values separated by `,` or ` or `. Anything the walk cannot consume is reported as `'when' values are separated by ',' or 'or'. Anything after '<consumed>' will be ignored` with a truncation autofix that matches what the runtime executes. Covers junk between values (`1 huh 2`), junk after a valid list (`'a' or 'b' | upcase`), trailing separators (`1,`), and the `{% liquid %}` statement form (same LiquidBranch node). Empty when markup left silent (typing-state; runtime raises — noted for future consideration). 5 tests in InvalidWhenMarkup.spec.ts; full monorepo suite green (3059).
<!-- SECTION:FINAL_SUMMARY:END -->
