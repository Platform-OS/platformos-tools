---
id: TASK-60.3
title: >-
  Grammar over-/under-acceptance: `{% if and b %}` parses, log-tag junk parses,
  unicode identifiers rejected
status: Done
assignee: []
created_date: '2026-08-05 20:51'
updated_date: '2026-08-05 21:23'
labels:
  - parser
  - bug
dependencies: []
references:
  - packages/liquid-html-parser/grammar/liquid-html.ohm
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/InvalidConditionalNode.ts
parent_task_id: TASK-60
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grammar-level issues found during the TASK-60 sweep (2026-08-05). These are in `packages/liquid-html-parser/grammar/liquid-html.ohm` — unlike the TASK-60 linter fixes, these change what the parser accepts, so both tolerant and strict grammars need the same edit and downstream snapshot/prettier tests may move.

1. **`{% if and b %}` parses successfully** (markup becomes a Condition, not a string fallback), so no check can ever see it. Cause: `condition<delim> = logicalOperator? space* (comparison | liquidExpression) space*` (liquid-html.ohm:371) makes the leading logical operator optional on EVERY condition, including the first. The runtime raises SyntaxError for a leading `and`/`or` (lax_parse pops expressions and hits an empty chunk). Fix: the first condition in `liquidTagOpenConditionalMarkup` must not accept a logicalOperator prefix; subsequent ones must require it (the zero-width `conditionSeparator = &logicalOperator` design needs care here).

2. **`{% log a ctn b %}` parses as LogMarkup** — the `liquidTagLogArguments` rule swallows the junk, so the tag never falls back to string and no offense fires. Verify what the runtime's log tag does with `a ctn b` (Ruby impl in ~/projects/desksnearme), then tighten the grammar rule (or add a check) accordingly.

3. **Unicode identifiers: `{% if café == \"x\" %}` is grammar-rejected but runtime-ACCEPTED** (Ruby's QuotedFragment is byte-permissive; the Ohm identifier rule is ASCII-only). Today the linter deliberately stays silent on this shape (the structural walk finds a well-formed comparison and returns null), so there is no false positive — but the grammar producing a string fallback for valid-at-runtime code means such tags lose parsed-markup features (formatting, completions inside markup). Consider extending the identifier rule to unicode letters. This is also a standing warning: 'markup is a string' means grammar-rejected, NOT runtime-invalid — any future check keying off the fallback must keep mediating (see TASK-60 implementation notes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `{% if and b %}` and `{% unless or x %}` fall back to string markup (or parse-error) and LiquidHTMLSyntaxError reports them; `{% if a and b %}` still parses
- [x] #2 log-tag runtime behavior for junk arguments is verified against the Ruby implementation and the grammar/check made consistent with it
- [x] #3 Decision recorded (and implemented or explicitly deferred) on unicode identifiers in the identifier rule, with `{% if café == "x" %}` as the test case
- [x] #4 liquid-html-parser, prettier-plugin and platformos-check-common suites pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two grammar edits in liquid-html.ohm (base `Liquid` grammar — inherited by all tolerant/strict/statement variants, no CST-mapping changes needed since a negative lookahead has arity 0):

1. `liquidTagOpenConditionalMarkup` now starts with `~logicalOperator` — `{% if and b %}` / `{% unless or b %}` fall back to string markup and LiquidHTMLSyntaxError reports "Conditional cannot start with 'and'" via the checkConditionStructure branch that already existed for this shape. Identifiers merely starting with and/or (`andy`) still parse; `a and b` unchanged. Parser regression test added to stage-2-ast.spec.ts, check test to InvalidConditionalNode.spec.ts.

2. `logArgument` is namedArgument-only. Runtime verified (app/lib/liquify/tags/log_tag.rb + base_tag_methods.rb): after the message, only `key: value` attributes are read (scan_plain_attributes); positional segments are silently dropped. Real-world confirmation: insites_pipeline module writes `{% log var, "Delete system_fields" %}` — that label never reaches the logs. Junk now falls back to string and the existing InvalidTagSyntax catch-all reports "Invalid syntax for tag 'log'" (log is a NamedTag not in the dedicated-checks exemption). The two fork-era parser tests pinning the "positional string argument (e.g. log label)" behavior encoded the same misconception and were updated to assert the fallback; new InvalidTagSyntax.spec.ts cases cover reported/valid log markup.

3. Unicode identifiers: the premise was WRONG — `{% if café == "x" %}` already parses because Ohm's `letter` is Unicode-aware, matching the byte-permissive runtime. No grammar change needed; decision recorded and pinned with a stage-2-ast.spec.ts test asserting `café` parses as a VariableLookup inside a Comparison.

Full monorepo suite green: 3059 tests / 310 files (was 3045), build + prettier-plugin suites clean.
<!-- SECTION:FINAL_SUMMARY:END -->
