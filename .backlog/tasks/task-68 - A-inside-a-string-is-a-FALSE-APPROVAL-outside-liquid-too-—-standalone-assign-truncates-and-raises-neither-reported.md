---
id: TASK-68
title: >-
  A %% } inside a string is a FALSE APPROVAL outside {% liquid %} too —
  standalone assign truncates and {{ }} raises, neither reported
status: To Do
assignee: []
created_date: '2026-08-06 16:10'
labels:
  - check
  - false-approval
  - measurement
  - liquid-parser
dependencies: []
references:
  - packages/platformos-check-common/src/checks/truncated-liquid-block/index.ts
  - >-
    packages/platformos-check-common/src/checks/truncated-liquid-block/index.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: medium
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

Found while building `TruncatedLiquidBlock` (TASK-67). That check covers the `{% liquid %}` block. The same lexer blindness exists in two other places, and neither is reported by anything.

## Measured on `/api/app_builder/liquid_exec`

```
{% assign s = "a %} b" %}[{{ s }}]     ->  " b\" %}[]"
                                           truncates: the tag ends at the %} inside the string,
                                           the rest is rendered as text, HTTP 200, no error

{{ "a %} b" }}                         ->  RAISED  Liquid syntax error:
                                           Variable '{{ "a %}' was not properly terminated
```

Our parser ACCEPTS both. `toLiquidHtmlAST` produces a `LiquidVariableOutput` for the second, and nothing in the toolchain reports either — a run of `allChecks` over `{% liquid assign a = 1 %}{{ '%}' }}` returns only `UnusedAssign`.

So both are **false approvals**: the supervisor answers `status: ok, must_fix_before_write: false` for a file the platform either mangles (assign) or refuses to parse (output). The output case is the worse of the two, because a parse error fails the deploy converter and takes the whole changeset.

## Relationship to TASK-67

`TruncatedLiquidBlock` deliberately does NOT claim these. Its rule is local to a `{% liquid %}` tag, and stretching it to cover standalone tags and outputs would give the wrong diagnosis for constructs that fail differently — one truncates silently, one raises at parse time. The check's spec pins the `{{ '%}' }}` case as "stays silent — a separate, still-unreported defect in the output lexer" so the gap is visible rather than implicit.

## Also worth settling in the same pass

A literal `%}` cannot appear in ANY Liquid string. The only spelling that works is composition, measured:

```liquid
{% assign pct = '%' %}{% assign cb = '}' %}[{{ pct | append: cb }}]   ->  "[%}]"
{% liquid
  assign s = "a %" | append: "} b"
%}[{{ s }}]                                                          ->  "[a %} b]"
```

That is the remedy any check here should name, and it is not guessable from the error text the platform gives.

## Fix shape

Two different defects, so probably two rules — or one rule with two messages:

- **Standalone tag with a string containing `%}`**: truncates silently, same profile as TASK-67. The tag's markup will have failed to parse and the delimiter will be stranded in the following text.
- **Output `{{ … }}` with a string containing `%}`**: the platform RAISES at parse time, so this one is a converter rejection and belongs in `BLOCKING_CHECKS` on the ordinary rule, not on the consequence exception TASK-67 needed.

Measure the blast radius first: `{% if x == "a %} b" %}`, `{% render 'p', k: "a %} b" %}`, filter arguments, and inside `{% raw %}` — before deciding how wide the rule is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The behaviour of a %% } inside a string is measured across tag positions beyond assign: if/unless conditions, render and function arguments, filter arguments, and inside {% raw %} — so the rule's width is chosen from data rather than assumed from the assign case
- [ ] #2 The standalone-tag truncation is reported with a message naming the truncation, not the tag's syntax, for the same reason TASK-67 does not defer to InvalidTagSyntax
- [ ] #3 The {{ }} case is reported and BLOCKS: unlike the liquid-block case the platform raises at parse time, so it clears the ordinary membership rule for BLOCKING_CHECKS rather than needing the consequence exception
- [ ] #4 Both messages name the measured composition remedy, since a literal %% } is not expressible in any Liquid string and the remedy is not guessable
- [ ] #5 False-positive rate measured on the same real-world corpus used for TASK-67 (7250 files / 6274 blocks) and reported
- [ ] #6 The placeholder assertion in truncated-liquid-block/index.spec.ts — 'stays silent on a %% } inside an output' — is updated to point at the new check rather than deleted, so the ownership boundary stays documented
- [ ] #7 Sabotage confirms the new tests bite, and TruncatedLiquidBlock's own suite still passes unchanged
<!-- AC:END -->
