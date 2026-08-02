---
id: TASK-38
title: >-
  Attribute the lint throughput regression and re-derive LINT_MS_PER_KIB from a
  controlled measurement
status: To Do
assignee: []
created_date: '2026-08-02 07:11'
labels:
  - mcp-supervisor
  - performance
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - packages/platformos-mcp-supervisor/src/cost-model.ts
  - packages/platformos-mcp-supervisor/src/cost-model.spec.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Observation

Round 4 re-measured lint throughput on the same machine and substrate as round 3, best of three:

| Probe | Round 3 | Round 4 | Change |
|---|---|---|---|
| 266 KiB batch, 4 files | 15 093 ms | 18 183 ms | +20% |
| single 128 KiB buffer | 6 233 ms | 8 783 ms | +41% |

Measured throughput is now about 68.5 ms/KiB against a modelled `LINT_MS_PER_KIB` of 75 — a 9% margin, down from roughly 24% in round 3.

## Why this is worth a task despite nothing being broken

P-01 remains closed: the worst legal batch runs 18.5 s against a 119 700 ms earned deadline. Nothing times out and nothing is at risk today.

It matters because the entire derived cap rests on that one constant. `MAX_BATCH_BYTES` is computed from it, so the cap is only meaningful while the constant is honest, and the direction of travel is toward it.

There is a second reason the number deserves explanation rather than monitoring: the constant was chosen with deliberate headroom over a measurement of 12 to 17 ms/KiB. Arriving at 68.5 means either the workload or the environment moved by roughly a factor of four, and neither has been established.

## What was NOT established

The round-4 report explicitly declined to attribute the slowdown. Candidates it named but did not isolate: the per-file async docset lookup added to `InvalidHashAssignTarget`, and the added YAML routing. It also noted the measurements came from the same machine as round 3 but not a controlled one, so part of the change may be environmental.

Attribution is the first half of this task; recalibration is only correct once the cause is known.

## Constraint

`cost-model.ts` carries an explicit instruction not to lower this constant to match a faster measurement. That rule stands. This task is about whether the constant is still an honest ceiling, which is the opposite direction and the one the rule was written to protect.<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The throughput change is attributed to a named cause or explicitly recorded as environmental, with the measurement that settles it
- [ ] #2 LINT_MS_PER_KIB is re-derived from a controlled measurement on an otherwise idle machine, and the doc comment records the new number, the date, and the machine it came from
- [ ] #3 If the constant changes, the derived MAX_BATCH_BYTES change is stated in bytes and its effect on a realistic large changeset is measured rather than assumed
- [ ] #4 The existing rule that this constant is never lowered to match a faster measurement is preserved and still explained at the call site
- [ ] #5 The worst legal batch is re-timed against its earned deadline, so the margin is a measured fact in the repo rather than a figure from an external report
<!-- AC:END -->
