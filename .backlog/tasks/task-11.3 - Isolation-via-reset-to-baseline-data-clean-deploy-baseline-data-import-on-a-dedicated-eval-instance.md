---
id: TASK-11.3
title: >-
  Isolation via reset-to-baseline: data clean + deploy baseline + data import,
  on a dedicated eval instance
status: To Do
assignee: []
created_date: '2026-07-09 11:00'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
  - isolation
dependencies:
  - TASK-11.1
parent_task_id: TASK-11
priority: high
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make each task hermetic by RESETTING the dedicated eval instance to the task's initial state before running it — not by namespacing artifacts. Confirmed 2026-07-09: a dedicated, disposable eval instance is provided (safe to `data clean`), so a full reset is simpler and more bulletproof than scoped delete.

## Reset-to-baseline (the per-task boundary)
Before each task, bring the instance to the task's well-defined initial state:
1. `data clean` — wipe all records.
2. `deploy <task baseline app>` — a full deploy makes the instance's CODE equal the baseline directory (removing the previous task's code). Baseline = the minimal skeleton for greenfield tasks, or the task's seed app for brownfield (fixtures owned by 11.5).
3. `data import <seed.json>` — only if the task declares seed data.
The next task's step 1 IS the teardown; a final reset runs after the suite. This is the MCPMark "well-defined initial state → run → verify → clean" lifecycle, implemented as full reset.

## Grading deploy (why the agent's deploy discipline doesn't matter)
After the agent finishes, the HARNESS does the authoritative deploy of the agent's final workspace onto the freshly-reset instance, THEN grades. So the graded instance state is a pure function of the agent's final files. The agent still has pos-cli connected and may deploy/test during its run — that's fine and realistic — but it never affects the grade.

## Requirements
- Confirm + document `pos-cli deploy` fully replaces (removes remote files absent from the baseline dir); if it merges instead, add an explicit pre-clean of code so reset is total. This is the one platformOS assumption to verify empirically before relying on it.
- Reset is idempotent and runs in try/finally so a crashed/timed-out task still leaves a clean instance for the next.
- Runs are serialized (one instance, one task at a time); a log cursor is captured at reset for the 11.2 no_runtime_errors window.
- `deploy-wait` / `data-clean-status` are awaited (bounded) so a task never starts before the reset is live.
- Secrets/instance env (eval instance URL + token) come from env/config, never task files. Guardrail: refuse to run if the target env is not the designated eval instance (prevent an accidental `data clean` against a real instance).
- An `evals reset` command performs a standalone reset (for local debugging / recovery).

## Grounding
MCPMark explicit-state lifecycle; the dedicated-instance + full-reset model is the standard way to get true hermeticity when the environment can be cheaply rebuilt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Before each task the instance is reset to the task's initial state: data clean + full deploy of the task baseline + optional data import, awaited until live
- [ ] #2 The harness deploys the agent's FINAL workspace authoritatively before grading, so the graded state is a pure function of the agent's final files (agent deploy discipline is irrelevant)
- [ ] #3 pos-cli deploy is confirmed to fully replace instance code (remote files absent from baseline are removed); if not, a pre-clean makes reset total — documented either way
- [ ] #4 Reset is idempotent and runs in try/finally so a crashed/timed-out task still leaves a clean instance for the next
- [ ] #5 A safety guard refuses to run unless the target env is the designated dedicated eval instance (no accidental data clean of a real instance)
- [ ] #6 Runs are serialized; a log cursor is captured at reset for the no_runtime_errors grader window
- [ ] #7 An `evals reset` command performs a standalone reset for debugging/recovery
<!-- AC:END -->
