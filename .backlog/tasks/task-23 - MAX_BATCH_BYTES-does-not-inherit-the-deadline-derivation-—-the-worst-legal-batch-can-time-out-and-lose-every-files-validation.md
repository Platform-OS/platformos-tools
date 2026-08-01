---
id: TASK-23
title: >-
  MAX_BATCH_BYTES does not inherit the deadline derivation — the worst legal
  batch can time out and lose every file's validation
status: To Do
assignee: []
created_date: '2026-08-01 02:59'
labels:
  - bug
  - mcp-supervisor
  - robustness
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/validate/batch-bounds.ts
  - packages/platformos-mcp-supervisor/src/context.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`MAX_BUFFER_BYTES` (128 KiB) was carefully derived FROM `LINT_DEADLINE_MS`: the worst single buffer measures ~10 s idle and ~23 s under load, and 60 s was chosen to give ~2.6x headroom over the loaded figure. That derivation is documented at length in `context.ts`.

`MAX_BATCH_BYTES` did not inherit it. It is set as a round `4 * MAX_BUFFER_BYTES` = 512 KiB, justified only as "four worst-case single buffers, so a batch can never cost more than a handful of legal single calls". But the deadline is per-REQUEST, not per-call, so four worst buffers in one request consume 4x the work against the same 60 s budget.

Measured at the bound:

```
4 files x 127 KiB = 508 KiB  ->  27 943 ms   (all 4 checked, gate correct)
LINT_DEADLINE_MS = 60 000 ms ->  2.1x headroom, on an IDLE box
```

Applying the same 2-3x load factor that motivated the 60 s deadline puts the worst legal batch at roughly 56-84 s — at or past the deadline.

## Why this matters more than a slow call

The failure mode is total, not degraded. A lint timeout yields `not_applicable` / `timed_out` for **every** file in the request, so a large-but-legal changeset receives no validation at all — silently, and precisely when it is the most expensive to get wrong. `context.ts` already argues this exact point for the single-buffer case: "a deadline that fires on a legitimately slow call is WORSE than none".

## Direction

Either is acceptable; the point is that the batch bound must be derived rather than chosen as a round multiple.

1. Derive `MAX_BATCH_BYTES` from `LINT_DEADLINE_MS` and the measured ms/KiB the way `MAX_BUFFER_BYTES` is, preserving comparable headroom under load.
2. Scale the deadline for multi-buffer requests, so the budget grows with the work admitted.

Whichever is chosen, the constant must carry the derivation in its comment, so the next person changing either value sees that the two are coupled.

## Supporting measurement

Independent benchmarking in the same evaluation confirms the documented cost model is accurate — 57 ms/KiB above 16 KiB against a claimed 61, and 7.3 s at the 127 KiB bound against a claimed 7.1 s — so `MAX_BUFFER_BYTES` itself is calibrated correctly and should not move. Note also that cost is driven by parse work rather than size alone (127 KiB of a repeated single character validates in 2.5 s), so any derivation should be stated against representative markup, as the existing one is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `MAX_BATCH_BYTES` (or the multi-buffer deadline) is derived from `LINT_DEADLINE_MS` and the measured cost model, not set as a round multiple
- [ ] #2 The worst legal batch is measured under load, not only idle, and retains headroom comparable to the ~2.6x the single-buffer bound was given
- [ ] #3 The constant's comment states the derivation and names the coupling to `LINT_DEADLINE_MS`, so changing one surfaces the other
- [ ] #4 A request at the new bound completes within the deadline under load, verified by measurement rather than calculation
- [ ] #5 A request that exceeds the bound is still refused whole, with nothing reported as checked — the existing refusal semantics are preserved
- [ ] #6 The existing per-buffer `MAX_BUFFER_BYTES` bound is unchanged, since independent benchmarking confirms it is correctly calibrated
<!-- AC:END -->
