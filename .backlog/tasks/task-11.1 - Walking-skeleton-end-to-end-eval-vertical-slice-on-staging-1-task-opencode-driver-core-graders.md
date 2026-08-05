---
id: TASK-11.1
title: >-
  Walking skeleton: end-to-end eval vertical slice on staging (1 task, opencode
  driver, core graders)
status: To Do
assignee: []
created_date: '2026-07-09 11:00'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
dependencies: []
parent_task_id: TASK-11
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The runnable-today vertical slice: one task, one driver, real staging, the core graders, guaranteed teardown, one result row. Everything else in TASK-11 hardens/broadens this. Prove the whole loop works before scaling it.

## Scope (thin but complete)
- Decide + document the harness home and language: `evals/` dir (repo-root vs under packages/platformos-mcp-supervisor — recommend repo-root `evals/` so it can drive any project). Language: pick TS (reuse check-node graders / same toolchain) or Python (user's sketch); record the decision + why in a short README.
- `tasks.yaml` schema v0 (formalize the user's sketch): `id`, `brief`, `setup` (optional seed), `expect` (subset for the slice: `renders`, `model`, `form_persists`, `isolated`), `timeout`, `weight`. One task: `blog_basic`.
- Runner skeleton `run_agent_evals`: per-task lifecycle — snapshot → drive → deploy → assert → teardown → row — with real teardown even on failure/timeout (try/finally).
- One driver: opencode headless (`opencode run "<brief>"`) with the pos-supervisor + pos-cli in its MCP config; capture transcript + workspace diff as artifacts.
- Core graders only (full engine is 11.2): `renders` (endpoints-list + authenticated HTTP GET 200 + marker) and `model` (graphql-exec introspection). `form_persists` may stub to a TODO if time-boxed, but `renders`+`model` must be real.
- Config via env: `MPKIT_URL` (staging), the pos env name, opencode config path. A single `run-evals` command prints one row.

## Grounding
Mirrors the MCPMark lifecycle (initial state → agent → programmatic verify → cleanup) and Anthropic's outcome-not-claim rule (verify the model/route exists on the instance, not the transcript). Deliberately one task / one driver so the plumbing is proven before 11.2–11.6 scale it.

## Out of scope (later children)
Full grader set (11.2), data snapshot/restore hardening (11.3), second driver (11.4), more tasks (11.5), ablation + pass@k (11.6), Tier A (11.7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single documented command runs blog_basic end-to-end against a real staging instance, unattended, and prints one pass/fail row
- [ ] #2 tasks.yaml v0 schema is defined and documented (id/brief/setup/expect/timeout/weight); blog_basic is expressed in it
- [ ] #3 The opencode-headless driver runs the brief with pos-supervisor + pos-cli connected and captures transcript + workspace artifacts
- [ ] #4 renders and model graders verify real staging state (endpoints-list + HTTP 200 + marker; graphql-exec introspection) — not transcript text
- [ ] #5 Teardown runs guaranteed (try/finally) and removes the task's staging artifacts even on failure/timeout
- [ ] #6 A README records the harness home + language decision and how to run it against staging
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed decisions folded in: harness = TypeScript. Per-task loop = reset instance (data clean + deploy baseline + optional data import) → agent workspace is a local copy of that baseline → drive agent (supervisor + pos-cli connected) → HARNESS deploys the agent's final workspace authoritatively → grade live instance → reset. Grading is a pure function of the agent's final files, NOT of whether the agent deployed. blog_basic's starting workspace is the minimal baseline skeleton fixture (11.5); teardown is the next task's reset (plus a final reset). Dedicated eval instance is provided by the user (safe to data clean).
<!-- SECTION:NOTES:END -->
