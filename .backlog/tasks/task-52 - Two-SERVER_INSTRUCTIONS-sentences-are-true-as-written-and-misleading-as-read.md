---
id: TASK-52
title: Two SERVER_INSTRUCTIONS sentences are true as written and misleading as read
status: In Progress
assignee: []
created_date: '2026-08-03 11:15'
updated_date: '2026-08-03 16:43'
labels:
  - mcp-supervisor
  - agent-surface
  - eval-final
dependencies:
  - TASK-47
  - TASK-51
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`SERVER_INSTRUCTIONS` is spent context in every session and is the agent's entire model of the tool. A sentence that overstates coverage converts "I do not know" into false confidence — which is the failure mode this whole server exists to prevent. Both sentences below pass a literal reading and mislead in practice.

## (a) The filter sentence draws the boundary in the wrong place

> "A filter in a tag OPERAND is fine and is NOT reported — cache, log, yield, redirect_to, response_headers, spam_protection, render's with/for, case, when and cycle each take one."

Literally true and verified: `{% log 'm' | upcase %}` is allowed. But it names ten tags and tells an agent filters are fine **in them**, and the very next thing an agent writes — `{% log 'm', type: 't' | upcase %}` — is a false block on a buffer the converter accepts (TASK-47).

The boundary is the **position within** the tag, not the tag. The sentence I wrote invites exactly the wrong generalisation.

**Depends on TASK-47.** Once the argument-value positions accept filters, this sentence becomes accurate as read and may need only a small widening rather than a rewrite. Do not rewrite it before that lands, or it will describe a state the code is about to leave.

## (b) The duplicate-key sentence is stated without qualification

> "A key defined TWICE in the same mapping is reported as a warning and does NOT block."

False for 11 of the 61 tokens in the project's own Psych corpus. `en:\n  .inf: 1\n  .inf: 2` — literally the same text twice, one key on the platform, last value wins — produces **no warning at all** (TASK-51).

**Depends on TASK-51.** If that task closes the diagonal gap the sentence becomes true and needs no change; if a measured gap remains, the sentence must say so, because an instruction that overstates what IS reported turns a silence the agent receives into something it was told could not happen.

## What is NOT wrong — seven claims verified

The eval checked nine instructions claims. These seven pass, and the two that fail are above:

- the text is returned on `initialize` (5704 chars)
- columns count UTF-16 code units — verified precisely, paired: `{{ '👋' }}` and `{{ 'ab' }}` both put the next diagnostic at column 16, `{{ 'a' }}` at 15
- `errors[]` can be non-empty while `must_fix_before_write` is false
- `ignored` returns `not_applicable`
- GraphQL operations are validated against the project schema
- the YAML 1.1 collision examples (`yes:`/`true:`, `014:`/`12:`, `null:`/`~:`) — all three correct
- coverage is per project

## Constraints

Claims here are pinned by `validate-code.spec.ts` precisely so they cannot rot. Any sentence change updates its assertion in the same edit, and the assertion must pin the *substance* rather than the wording. The supervisor stays a thin layer: no behaviour change belongs in this task.

Keep it short. This text competes with the user's actual task for context.

## Falsifier

An agent reading the corrected text and still generalising to a position the converter rejects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The filter sentence states the rule by POSITION, so an agent cannot generalise from operand to argument value — reconciled with whatever TASK-47 actually shipped
- [ ] #2 The duplicate-key sentence is either true without qualification, or names the remaining gap — reconciled with whatever TASK-51 actually shipped
- [ ] #3 Both sentences are pinned in validate-code.spec.ts by substance, not by exact wording, in the same change
- [ ] #4 The instructions do not grow materially — this is spent context on every session
- [ ] #5 The seven claims that currently pass still pass
<!-- AC:END -->
