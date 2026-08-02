---
id: TASK-11.2
title: >-
  Assertion engine: full code-based grader set over live staging
  (renders/model/form_persists/no_runtime_errors/lint_clean)
status: To Do
assignee: []
created_date: '2026-07-09 11:00'
updated_date: '2026-08-04 12:48'
labels:
  - eval
  - pos-supervisor
  - graders
dependencies:
  - TASK-11.1
parent_task_id: TASK-11
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Harden the grader engine into the full deterministic assertion set, each verifying live instance STATE (outcome, never transcript claim — Anthropic). Every `expect.*` key maps to one grader returning {passed, detail, evidence}. Task score = fraction of assertions passed (partial credit).

## Graders (all code-based, over pos-cli + HTTP)
- `renders: [slug,…]` — `endpoints-list` contains the route AND an authenticated HTTP GET returns 200 with an expected content marker AND is not the platformOS error page. Handles auth (session/token from env).
- `model: {name, fields:[{name,type?}]}` — GraphQL introspection / `graphql-exec` confirms the custom model exists and each field exists (type-checked when given).
- `form_persists: <slug|{path,fields}>` — GET the form (CSRF/authenticity token), HTTP POST the fields, then `graphql-exec` the records table and assert a row with the posted values exists. The canonical claim-vs-outcome check.
- `no_runtime_errors` — `logs-fetch` from the pre-run cursor shows no new error-level entries attributable to the task namespace.
- `lint_clean` — `check-run` (or check-node lintBuffer) over the deployed files returns zero errors/warnings — ties the outcome back to the linter the supervisor wraps.
- `isolated` — enumerate created artifacts (endpoints/records/files under the task namespace) and assert none leak outside it; also the teardown-verify hook for 11.3.

## Requirements
- Each grader is pure w.r.t. its inputs (instance handle + expect spec) and returns structured evidence for the row (so a failure is debuggable without re-running).
- Graders are validated against a reference solution (11.5): on the reference, all assertions PASS; on a deliberately-broken variant, the relevant assertion FAILS (both directions, per Anthropic — avoid one-sided graders).
- Robust to eventual consistency: bounded poll/retry for deploy propagation and record visibility; never an unbounded wait.
- Optional LLM-judge grader is scaffolded but reserved for subjective dimensions only, one rubric dimension per judge call (not used for the objective graders above).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each expect.* key (renders, model, form_persists, no_runtime_errors, lint_clean, isolated) has a grader that verifies live staging state and returns {passed, detail, evidence}
- [ ] #2 Task score is the fraction of assertions passed (partial credit), not binary
- [ ] #3 form_persists submits the form and verifies the persisted record via graphql-exec (claim-vs-outcome)
- [ ] #4 Every grader is proven in BOTH directions against a reference solution and a broken variant (passes when correct, fails when broken)
- [ ] #5 Graders bound-poll for propagation/consistency and never wait unbounded
- [ ] #6 Failures emit structured evidence sufficient to debug without re-running the agent
<!-- AC:END -->
