---
id: TASK-26
title: >-
  ValidFrontmatter findings that hard-fail the deploy are warnings and do not
  block — needs a discriminator before the gate can act
status: To Do
assignee: []
created_date: '2026-08-01 03:00'
updated_date: '2026-08-04 12:48'
labels:
  - bug
  - mcp-supervisor
  - correctness
  - blocked
dependencies:
  - TASK-8.1
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking.ts
priority: medium
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`ValidFrontmatter` is `Severity.WARNING` and absent from `BLOCKING_CHECKS`, but two of its three measured findings are hard deploy rejections. A deploy rejection fails the ENTIRE changeset, not just the offending page, so these are the highest-blast-radius false approvals in the evaluation.

| Buffer | validate_code | Deploy |
|---|---|---|
| `not_a_real_frontmatter_key: 1` | `warning` ValidFrontmatter @3:1 | **REJECTED** — "Unknown properties" |
| `layout: no_such_layout` | `warning` ValidFrontmatter @3:1 | **REJECTED** — "Could not find Layout" |
| `authorization_policies: [no_such]` | `warning` ValidFrontmatter @4:5 | accepted |

The check detects all three accurately and positions them correctly. Only the verdict is wrong.

## Why this cannot be fixed in the supervisor alone

All three findings share the single check code `ValidFrontmatter`, with no structured discriminator on the offence. Adding the code to `BLOCKING_CHECKS` would correctly block the first two and introduce a NEW false block on the third.

This is the identical shape `blocking.ts` already documents for `PartialCallArguments` — one code reporting two different things, no discriminator, and non-goal #2 forbidding regex over message strings to tell them apart. There the resolution was to leave it non-blocking because the blocking half was independently covered. Here it is not covered by anything.

So the supervisor cannot resolve this without either:

- a structured identifier on the offence that distinguishes the finding (the general solution — see TASK-8.1, which extends the check-common seam with typed data on `Offense`), or
- splitting `ValidFrontmatter` into distinct check codes in check-common.

Both are engine-side. This task exists to hold the supervisor-side decision and to make sure the gap is not silently inherited once a discriminator exists.

## Interim question to decide

Until a discriminator lands, is the current state — two deploy-fatal findings reported only as warnings — acceptable? A defensible interim step is to leave the gate alone but make the SEVERITY of the situation visible to the agent, given that `must_fix_before_write: false` on a changeset-killing error is the worst false-approval class the evaluation found. Decide deliberately and record the reasoning; do not leave it undecided by default.

## Related

The evaluation's broader structural point: the gate models runtime failure but not deploy-time failure, and eight of its nine confirmed false approvals are deploy-time. This task is the one instance of that class that is even partly supervisor-owned; the rest require new detection in check-common.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded on the interim state — whether two deploy-fatal findings reported only as warnings is acceptable until a discriminator exists — with its rationale
- [ ] #2 Once a discriminator is available, the unknown-key and missing-layout findings yield `must_fix_before_write: true`
- [ ] #3 The `authorization_policies` finding does NOT block, verified against the instance, so the fix does not trade a false approval for a false block
- [ ] #4 `blocking.ts` records why `ValidFrontmatter` is absent from the set while it remains absent, in the same place the `PartialCallArguments` reasoning lives, so the gap is documented rather than invisible
- [ ] #5 The dependency on a structured offence discriminator is explicit, so this is not attempted with message-string matching (non-goal #2)
- [ ] #6 Verified end to end against a real deploy, since the failure being modelled is deploy-time rather than runtime
<!-- AC:END -->
