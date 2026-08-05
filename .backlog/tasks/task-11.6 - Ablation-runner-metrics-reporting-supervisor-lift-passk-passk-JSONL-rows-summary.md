---
id: TASK-11.6
title: >-
  Ablation runner + metrics/reporting: supervisor-lift, pass@k / pass^k, JSONL
  rows + summary
status: To Do
assignee: []
created_date: '2026-07-09 11:01'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
  - metrics
dependencies:
  - TASK-11.2
  - TASK-11.3
  - TASK-11.4
  - TASK-11.5
parent_task_id: TASK-11
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The payoff layer: run each task in both arms (supervisor-connected vs control), k times, and report the SUPERVISOR LIFT — the number that justifies the tool. This closes the epic into a single automatable command.

## Arms (the ablation — the reason this eval exists)
- `supervisor` arm: agent's MCP config includes pos-supervisor + pos-cli.
- `control` arm: identical model/brief/graders/driver, pos-supervisor REMOVED (pos-cli only).
Same task, same seed, same graders. Per Anthropic you always evaluate harness+model together, so the controlled A/B is the only way to attribute the delta to the supervisor.

## Metrics (per task, per arm, per driver)
- pass@1, pass@k (≥1 of k trials passes), pass^k (all k pass) — variance-aware.
- task score (fraction of assertions passed) — partial credit, averaged over trials.
- iterations-to-green (agent turns until all graders pass; ∞ if never) — from driver.iterations.
- Aggregates: completion rate per arm; and the LIFT = Δ(completion), Δ(lint_clean rate), Δ(iterations-to-green) between supervisor and control.

## Runner + output
- `run_agent_evals --arm supervisor|control|both --driver … --k N --task <id|all>`; sequential by default (11.3), guaranteed teardown per trial.
- Rows to JSONL (one per trial: task, arm, driver, model, k-index, per-assertion results, score, iterations, exitReason, artifact paths, timings, seed).
- A human summary (table): per-task per-arm pass@k/pass^k/score + the headline lift. Optional Artifact/HTML report as a stretch.
- A single documented command runs the whole suite, both arms, against staging, unattended — with env for MPKIT_URL + provider creds.

## Requirements
- Deterministic aggregation from the JSONL (re-runnable report without re-running agents).
- Token/time budget guardrails (max trials, per-task timeout) so a full run is bounded and cost-estimable.
- Statistical honesty: report k and n; do not over-claim lift on tiny n (surface the sample size next to the delta).

## Grounding
Anthropic pass@k/pass^k + outcome grading + partial credit; the ablation is the standard way to isolate a harness component's contribution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The runner executes both arms (supervisor vs control = pos-supervisor removed) over the same tasks/seeds/graders/driver
- [ ] #2 Per task/arm/driver it reports pass@1, pass@k, pass^k, mean task score, and iterations-to-green
- [ ] #3 The summary emits the supervisor LIFT: Δ completion rate, Δ lint_clean rate, Δ iterations-to-green, with k and n shown
- [ ] #4 All trials are written as JSONL rows and the summary is reproducible from the rows without re-running agents
- [ ] #5 A single documented command runs the full suite, both arms, against staging unattended, within a bounded token/time budget
- [ ] #6 The report states sample size alongside every delta (no over-claiming on small n)
<!-- AC:END -->
