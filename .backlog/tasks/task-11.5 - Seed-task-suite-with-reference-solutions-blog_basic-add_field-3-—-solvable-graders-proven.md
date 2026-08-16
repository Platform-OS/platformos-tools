---
id: TASK-11.5
title: >-
  Seed task suite with reference solutions (blog_basic, add_field, +3) —
  solvable + graders proven
status: To Do
assignee: []
created_date: '2026-07-09 11:01'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
  - tasks
dependencies:
  - TASK-11.2
parent_task_id: TASK-11
priority: medium
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Author the initial task suite covering the core platformOS build motions, each with a REFERENCE SOLUTION that passes its own graders (Anthropic/MCP-Atlas: a task must be provably solvable and its grader proven correct). Every task must be unambiguous — two platformOS devs would independently reach the same pass/fail.

## Tasks (v1 suite, each in tasks.yaml + a reference-solution dir)
- `blog_basic` — "Build a simple blog where visitors read posts and an admin can add them." expect: renders [blog, blog/new], model {name: post, fields:[title, body]}, form_persists blog/new, no_runtime_errors, lint_clean, isolated.
- `add_field` — "Add a 'priority' choice field (high/med/low) to the tasks app." (setup seeds a minimal tasks app.) expect: model {name: task, fields:[priority]}, no_runtime_errors, lint_clean, isolated.
- `list_with_query` — "Show a page listing all posts newest-first." expect: renders [posts], a graphql query file exists, the page lists seeded records (HTTP body contains seeded titles).
- `validation_rejects` — "The new-post form must reject a blank title." (negative/edge case.) expect: form_persists blog/new for a valid post; a blank-title submit does NOT create a record (assert absence) and re-renders with an error.
- `partial_reuse` — "Extract the post card into a reusable partial and render it on the list and detail pages." expect: a partial exists and is rendered by ≥2 pages (graph dependents ≥2 via project_map/graph), renders [posts, posts/:id], lint_clean.

## Requirements
- Each task ships a reference solution (files + any seed) that scores 100% of its assertions — this is the grader/task self-test in CI-adjacent form (mock driver applies the reference diff → all pass).
- Include the negative case (`validation_rejects`) so graders aren't one-sided.
- Briefs are outcome-phrased (WHAT), never prescriptive of files/tool-order (outcome-not-path).
- Fields/slugs are namespaced-friendly for 11.3 isolation.

## Grounding
MCP-Atlas reference-trajectory validation + Anthropic's "reference solutions prove solvable and verify graders" and "test positive and negative cases".
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ≥5 tasks authored in tasks.yaml spanning render, model, model-field, list/query, validation (negative), and partial-reuse motions
- [ ] #2 Each task has a reference solution that scores 100% of its assertions via the mock driver (task solvable + graders proven)
- [ ] #3 The suite includes at least one negative/edge task (a submit that must NOT persist) so graders are two-sided
- [ ] #4 All briefs are outcome-phrased and unambiguous (two platformOS devs reach the same verdict); none prescribe files or tool order
- [ ] #5 Task fields/slugs are namespace-compatible with 11.3 isolation
- [ ] #6 A make/CLI target runs all reference solutions through the graders as a self-test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixture layout (confirmed 2026-07-09). Each task owns a fixture dir the runner consumes: `evals/fixtures/<task>/baseline/` (the initial-state app deployed at reset — for greenfield tasks this is a shared MINIMAL SKELETON app: config + one base layout, nothing domain-specific; for brownfield tasks like add_field it is a small seed app, e.g. a minimal tasks app), optional `evals/fixtures/<task>/seed.json` (records imported at reset), and `evals/fixtures/<task>/reference-solution/` (the completed workspace that scores 100% of graders — used ONLY for the mock-driver self-test, never shown to the agent). We do NOT pre-build the blog: blog_basic's baseline is the empty skeleton and building the blog is the task. Author ONE reusable minimal skeleton for greenfield tasks + small per-task seed apps for brownfield ones. Keep them tiny and purpose-built (NOT project-d, which is far too large/noisy for a baseline). The agent's starting workspace is a copy of `<task>/baseline/`.
<!-- SECTION:NOTES:END -->
