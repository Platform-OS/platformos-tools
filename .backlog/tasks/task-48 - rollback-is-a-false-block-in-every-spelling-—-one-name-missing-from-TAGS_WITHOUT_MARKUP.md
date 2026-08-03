---
id: TASK-48
title: >-
  {% rollback %} is a false block in every spelling — one name missing from
  TAGS_WITHOUT_MARKUP
status: To Do
assignee: []
created_date: '2026-08-03 11:13'
labels:
  - liquid-html-parser
  - false-block
  - eval-final
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/liquid-html-parser/src/grammar.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`{% rollback %}` is refused by the write gate. The converter accepts it, bare and inside a `{% transaction %}` block. A false block is unappealable, and the diagnostic is self-refuting:

```
LiquidHTMLSyntaxError: Invalid syntax for tag 'rollback' Expected syntax: rollback
```

It says the expected syntax is exactly what was written.

## Cause, and the exact bound

The grammar rule is `liquidTagRollback = liquidTagRule<"rollback", empty>`, so the AST markup is `""` — a string, but legitimately empty. `InvalidTagSyntax` uses "markup is a string" as its tolerant-fallback signal and exempts an allowlist:

```ts
// packages/liquid-html-parser/src/grammar.ts:50
export const TAGS_WITHOUT_MARKUP = ['else', 'break', 'continue', 'comment', 'raw', 'doc', 'try'];
```

The grammar has **exactly five** tags whose markup rule is `empty` — `try` (254), `rollback` (310), `break` (365), `continue` (366), `else` (367). Four are on the allowlist. `rollback` is the only one missing, and no other tag can be in this state.

## Independently re-verified

Every spelling blocks: `{% rollback %}`, `{%rollback%}`, `{%- rollback -%}`, and inside a transaction. Controls `{% try %}x{% endtry %}` and `{% break %}` both pass, which is what localises the defect to the missing name rather than to the fallback logic.

## Note on scope — do not fold this in

`{% transaction t %}x{% endtransaction %}` also blocks (*"Expected syntax: transaction timeout: 5"*) while `{% transaction %}` and `{% transaction timeout: 5 %}` pass. That is a positional-argument shape and belongs to the argument-value class, not here. It is unsettled — it needs a converter adjudication before anyone changes it.

## Why the check, not the grammar

The grammar is correct: `rollback` genuinely takes no markup. Fixing this in the grammar would be treating a symptom. `TAGS_WITHOUT_MARKUP` is the parser's own declaration of which tags legitimately have empty markup, and it is shared by `InvalidTagSyntax` and `UnknownTag` — it is the right place, and it is exported from `liquid-html-parser`, so `check-common` needs no change.

## Falsifier

A dry run that rejects `{% rollback %}`, or a `rollback` node whose markup is not a string.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 {% rollback %} produces no diagnostic, in every spelling including {%rollback%}, {%- rollback -%}, inside {% liquid %} and inside a transaction block
- [ ] #2 The four tags already on the allowlist still produce no diagnostic — controls, so a wider change is visible
- [ ] #3 A tag that genuinely HAS malformed markup still reports — the suppression must not widen into a real defect
- [ ] #4 The allowlist is asserted against the grammar's own set of empty-markup tags, so a future empty-markup tag cannot be silently omitted the same way
<!-- AC:END -->
