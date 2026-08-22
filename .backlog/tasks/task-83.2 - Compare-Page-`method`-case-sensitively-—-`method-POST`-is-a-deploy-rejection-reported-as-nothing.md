---
id: TASK-83.2
title: >-
  Compare Page `method` case-sensitively — `method: POST` is a deploy rejection
  reported as nothing
status: To Do
assignee: []
created_date: '2026-08-22 16:31'
labels:
  - platformos-check
  - platformos-common
  - frontmatter
  - correctness
dependencies: []
parent_task_id: TASK-83
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

```liquid
---
slug: probe
method: POST
---
```

`validate_code` → `{"status":"ok","must_fix_before_write":false}`. Deploy → **REJECTED**, `Request method 'POST' is not allowed. Valid methods: delete, get, patch, post, put, options` (measured; `method: post` is accepted).

The enum branch lowercases both sides deliberately (`valid-frontmatter/index.ts:157-170`, *"so `GET` matches `get` etc."*). The platform does not: `page.rb:11` `VALID_REQUEST_METHODS` is lowercase and `:34` validates by `inclusion:`, while `page_converter.rb:127` `set_method` does not downcase.

## Constraint — do not make this global

ApiCall `request_type` is declared with UPPERCASE `enumValues` and must stay lenient: `api_call_notification.rb:16` validates presence only, with **no** inclusion validation, so there is no deploy-time rejection to mirror and tightening it would invent a false block.

So casing is a per-field property of the schema, not a property of the comparison.

## Shape

Add an explicit case-sensitivity flag to `FrontmatterFieldSchema` in `packages/platformos-common/src/frontmatter.ts` and set it on Page `method`. Every other enum field keeps today's behaviour. The comment that justifies case-insensitivity is rewritten to say which fields it is correct for and why the platform disagrees for `method`.

Depends on TASK-83.1 for the code this reports under (`InvalidFrontmatterValue`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `method: POST`, `method: Post` and `method: GET` each report, and `validate_code` returns `must_fix_before_write: true`
- [ ] #2 `method: post` and every other lowercase valid method stay silent, asserted alongside a case that must still report so the silence is not vacuous
- [ ] #3 ApiCall `request_type: get` and `request_type: GET` both stay silent, pinned as a deliberate asymmetry with the reason recorded
- [ ] #4 An invalid value for a case-sensitive field and for a case-insensitive field both still report, so the flag does not disable enum checking
- [ ] #5 The rationale comment names the fields the flag applies to and cites the platform validation it mirrors
- [ ] #6 Flipping Page `method` back to case-insensitive makes a test fail (sabotage-verified)
- [ ] #7 A changeset accompanies the change
<!-- AC:END -->
