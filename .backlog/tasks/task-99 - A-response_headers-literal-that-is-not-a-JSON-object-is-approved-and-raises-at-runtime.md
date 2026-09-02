---
id: TASK-99
title: >-
  A response_headers literal that is not a JSON object is approved and raises at
  runtime
status: To Do
assignee: []
created_date: '2026-08-26 16:59'
labels:
  - check-common
  - false-approval
  - measured
dependencies:
  - TASK-98
references:
  - >-
    packages/platformos-check-common/src/checks/liquid-html-syntax-error/checks/base-tag-value.ts
  - >-
    packages/platformos-check-common/src/checks/unconventional-tag-syntax/index.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: low
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The defect

`{% response_headers <literal> %}` is approved when the literal is well-formed Liquid but is not a JSON object. The platform refuses it with HTTP 501 at render time.

Measured on a live instance, and compared against our verdict:

| argument | our verdict | platform |
|---|---|---|
| `"{'X-Ae':'plain'}"` — single-quoted JSON keys | silent | HTTP 501 |
| `'[1,2]'` — valid JSON, but an array | silent | HTTP 501 |
| `'not json'` | silent | HTTP 501 |

`ResponseHeadersParser` needs a JSON **object**; anything else raises. Nothing reports it, so `must_fix_before_write` is `false` for a buffer that will 501.

## Why TASK-98 could not fix it

TASK-98 made `response_headers` non-blocking when the value the tag receives parses as a JSON object, via the allowlist in `tolerated-tag-markup.ts`. That allowlist is only consulted when the tag's markup is a **raw string** — i.e. when the strict grammar rule failed. These three arguments are well-formed Liquid, so the grammar parses them, `isToleratedTagMarkup` is never called, and no check in the engine looks at them.

Fixing this therefore needs a check that runs on PARSED markup. The logic already exists and is tested: `baseTagValue()` plus a JSON-object test, both in `liquid-html-syntax-error/checks/`.

They are pinned as `KNOWN_UNCHECKED_BY_ANY_CHECK` in `unconventional-tag-syntax/index.spec.ts`, asserting the current silence so the gap stays visible rather than implicit.

## Exposure is low — read this before prioritising

Measured over the 2,768-file production application in `substrate-large`: **zero occurrences.** There are exactly three `response_headers` TAG usages in the whole tree, and all three are literal JSON objects that behave correctly. (Three further grep hits are frontmatter `response_headers:`, a YAML key handled by a different converter, not this tag.)

The three shapes above were constructed while probing the argument boundary for TASK-98. They are a genuine false approval with no known real-world instance.

## A ceiling worth knowing before starting

The argument can be a variable — `{% response_headers my_headers %}` — whose value no static check can know. Any check here can only cover LITERAL arguments, and must stay silent on a variable rather than guess. That silence is not a defect; asserting it is part of the work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `response_headers` literal that is not a JSON object is reported, covering at least single-quoted keys, a JSON array, and a non-JSON string
- [ ] #2 A literal that IS a JSON object stays silent, asserted in the same test file so the two cannot drift apart
- [ ] #3 A variable argument is silent rather than guessed at, asserted explicitly so the silence is deliberate
- [ ] #4 The three shapes currently pinned as KNOWN_UNCHECKED_BY_ANY_CHECK in unconventional-tag-syntax/index.spec.ts are moved to the new check's spec, not left asserting a silence that no longer holds
- [ ] #5 The verdict is measured against the platform for every fixture — HTTP status read from liquid_exec, which carries a real controller — rather than reasoned from the JSON spec
- [ ] #6 Whether it blocks is decided on evidence: the platform returns 501, which is a runtime raise, so BLOCKING_CHECKS membership needs the same justification every other member carries
- [ ] #7 Deliberately reverting the change makes the new tests fail (sabotage-verified), recorded in the task notes
- [ ] #8 `pos-cli check` over the 2,768-file corpus reports no new offense — expected, since the tree has zero occurrences; a non-zero delta means the check is over-firing
<!-- AC:END -->
