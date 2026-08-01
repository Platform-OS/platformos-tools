---
id: TASK-24
title: >-
  Cap the diagnostics a single validate_code result can return, with honest
  truncation signalling
status: To Do
assignee: []
created_date: '2026-08-01 02:59'
labels:
  - mcp-supervisor
  - agent-surface
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There is no bound on how many diagnostics one result carries. A 2 000-offence file returns a **276 KiB** JSON payload with all 2 000 entries. The output is correct, but a single call can consume a large share of an agent's context window — and the supervisor exists to be called before every write, so this is the common path, not an edge case.

Every other unbounded dimension of a request is already bounded: buffer bytes, batch files, batch bytes, lint deadline, impact deadline. The diagnostics list is the one that was missed.

## The constraint that makes this non-trivial

Silent truncation would be a false-completeness bug of exactly the kind this package spends the most effort avoiding. An agent that receives 200 errors and is not told there were 2 000 will fix the 200 and write the file believing it is clean. That is strictly worse than the large payload.

So a cap is only acceptable alongside a signal the agent cannot miss:

- the true total must survive truncation
- `must_fix_before_write` must be computed from ALL diagnostics, before any truncation, so the gate is never softened by dropping the blocking one
- the result must say plainly that it is partial

Note that a file with thousands of offences is nearly always a file with a small number of root causes (an unclosed tag cascading, a missing docset). Ordering is already by line/column, so the head of the list is the most useful part — truncation is genuinely cheap here, provided it is announced.

## Design questions for the implementer

- One cap across all three buckets, or per bucket? Errors matter most; a cap that spends its budget on infos would be poor.
- Where should the total live so it cannot be mistaken for the returned count?
- Should the cap apply per file within a batch, per request, or both? A 50-file batch multiplies whatever is chosen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A file producing thousands of offences returns a bounded payload, with the bound stated as a named constant carrying its rationale
- [ ] #2 `must_fix_before_write` is computed from the complete diagnostic set before truncation — asserted by a case whose only blocking error sorts beyond the cap
- [ ] #3 A truncated result reports the true total for each affected bucket, distinguishable from the number of entries returned
- [ ] #4 A truncated result is self-describing: an agent reading only the JSON can tell that findings were withheld, without consulting the tool description
- [ ] #5 An untruncated result carries no truncation fields at all, so their presence is a reliable signal (consistent with the existing decision to drop permanently-empty stubs)
- [ ] #6 The interaction with batches is decided and tested — whether the cap is per file, per request, or both
- [ ] #7 Diagnostics remain ordered by line then column within each bucket, so the retained head is the top of the file
- [ ] #8 The tool description and server instructions state the cap and what a truncated result means
<!-- AC:END -->
