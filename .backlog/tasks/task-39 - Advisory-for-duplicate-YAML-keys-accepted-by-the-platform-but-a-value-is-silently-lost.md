---
id: TASK-39
title: >-
  Advisory for duplicate YAML keys: accepted by the platform, but a value is
  silently lost
status: To Do
assignee: []
created_date: '2026-08-02 09:16'
labels:
  - check-common
  - detection-gap
  - eval-round4
dependencies:
  - TASK-33
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

TASK-33 established that `pos-cli deploy --dry-run` accepts a repeated YAML key and resolves it last-wins, and removed the false block that refused those writes. Every YAML reader in the monorepo now agrees with that behaviour.

What remains is a real authoring defect with no diagnostic at all: the earlier value is silently discarded. In a translations file that means a translation the author wrote never appears, and nothing anywhere says so.

## Why this was deliberately NOT done in TASK-33

Three reasons, all of which still constrain the design:

1. It is not a deployability question. `must_fix_before_write` claims the platform will take the file, and the platform does. This must never block.
2. The server instructions currently tell an agent that a duplicated name is not reported, because the platform accepts both. TASK-33 made that sentence true. Adding a diagnostic makes it false again, so the instructions have to change in the same commit.
3. `YAMLSyntaxError` answers exactly one question — does this file parse — and its docstring commits it to syntax only. A semantic finding belongs in its own check with its own severity.

## The judgement to make

Whether a duplicated key is worth a diagnostic at all, and at what severity. The argument for: it is silent data loss, invisible in review, and the fix is unambiguous. The argument against: it is legal input the platform handles, and this server has spent four evaluation rounds learning that reporting legal input is its most expensive failure mode.

Whoever picks this up should decide that question explicitly rather than inherit it from this description.

## Falsifier

Evidence that the platform does something other than last-wins — merging, or taking the first value. The remedy text would then be wrong in a way an author would act on.<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A repeated key produces a NON-blocking diagnostic naming both positions, so the author can see which value is being discarded
- [ ] #2 must_fix_before_write stays false for a duplicate key, and a test asserts it: the platform deploys the file, so the write gate must not move
- [ ] #3 The severity decision is recorded with its reasoning, including why this is not an error despite discarding data
- [ ] #4 The check is separate from YAMLSyntaxError, whose docstring commits it to syntax only
- [ ] #5 The server instructions are updated in the same change, since they currently tell the agent a duplicated name is not reported at all
- [ ] #6 The must-stay-silent corpus is updated so it asserts the absence of a BLOCK rather than the absence of any diagnostic, wherever the two now differ
<!-- AC:END -->
