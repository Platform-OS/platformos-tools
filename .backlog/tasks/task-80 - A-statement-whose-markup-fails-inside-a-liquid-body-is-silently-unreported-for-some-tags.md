---
id: TASK-80
title: >-
  A statement whose markup fails inside a {% liquid %} body is silently
  unreported for some tags
status: To Do
assignee: []
created_date: '2026-08-18 12:02'
labels:
  - check-common
  - liquid-html-parser
  - false-approval
  - measured
dependencies: []
priority: medium
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured on the PRE-FIX build, so this predates TASK-66 and is not caused by it.

When a statement's markup rule fails inside a `{% liquid %}` body the tolerant parser stores it as raw markup — the same fallback as a tag — but nothing reports it for every tag.

Reported (block=true, LiquidHTMLSyntaxError): hash_assign h ['k'] = 9; function r ['k'] = 'lib/x'; log: x, type: 'E'; assign = 9; assign x =

SILENT (block=false) though the grammar refuses each and the platform raises: assign ((( = 9; echo ((( ; assign h .k = 9 (which the grammar refuses as of TASK-66)

The pre-fix parser confirms the split is pre-existing: 'assign ((( = 9' and 'echo (((' already produced raw markup and were already unreported.

Consequence: the same construct blocks as a tag and is approved inside a {% liquid %} body, so an author moving working-looking code into a liquid block loses the diagnostic. A FALSE APPROVAL of the same class TASK-66 fixed, one layer further in.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The tag form and the {% liquid %} body form of an identical malformed statement reach the same verdict
- [ ] #2 A statement with raw markup inside a liquid body is reported whichever tag it names
- [ ] #3 assign ((( = 9, echo ((( and assign h .k = 9 inside a liquid body all block, with the tag-form messages unchanged
<!-- AC:END -->
