---
id: TASK-11.7
title: >-
  Tier A: deterministic validate_code tool-contract eval (golden fixtures,
  hermetic, CI gate)
status: To Do
assignee: []
created_date: '2026-07-09 11:02'
labels:
  - eval
  - pos-supervisor
  - tier-a
  - ci
dependencies: []
parent_task_id: TASK-11
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The cheap, fast, hermetic layer that runs in CI and gates the expensive Tier B: assert the pos-supervisor's tool OUTPUT contract directly over a labeled fixture corpus — no agent, no instance, no tokens. Complements the agentic eval; catches tool-contract regressions in seconds (MCP-Bench's static/deterministic layer analogue).

## What it grades
Feed a labeled corpus of platformOS buffers through `validate_code` (via the real stdio bin or the in-process handler) and assert the structured result — the tool contract the agent depends on:
- Must-fix gate precision/recall: known-INVALID buffers (missing content_for_layout, missing partial, bad partial args, undefined object, etc.) produce the expected error with `must_fix_before_write: true`; known-VALID buffers produce no must-fix. Report precision/recall/F1 of the gate, not just pass/fail.
- Blast-radius (impact) correctness: for a curated mini-project, editing a shared partial reports the exact `dependents` set + `signature_risk` — reuses the graph fixtures/assertions already in the repo.
- Result-shape contract: every response conforms to the ValidateCodeResult schema (status, errors[], impact{…}); guards against silent contract drift the agent can't see.

## Requirements
- Fully hermetic (MockFileSystem / temp fixtures, no network, no staging) and fast enough to run on every PR.
- Corpus is labeled data (buffer + expected verdict) extendable by dropping a fixture; each entry is one assertion.
- Wired into the repo's existing vitest + CI so a contract regression fails the build; emits precision/recall so a drift in gate quality is visible, not just a red/green.
- This is the gate: Tier B (11.1–11.6) should only run when Tier A is green.

## Grounding
Anthropic "code-based graders where possible" (deterministic, fast, cheap) + MCP-Bench's layered static-verification approach. Directly reuses the check-node/graph test machinery already in this monorepo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A labeled corpus of valid/invalid platformOS buffers is graded through validate_code and reports must-fix-gate precision/recall/F1 (not just pass/fail)
- [ ] #2 Blast-radius assertions verify the exact dependents + signature_risk on a curated mini-project
- [ ] #3 Every response is validated against the ValidateCodeResult schema (contract-drift guard)
- [ ] #4 The whole tier is hermetic (no network/instance/tokens) and runs in the repo's vitest/CI on every PR
- [ ] #5 Adding a fixture (buffer + expected verdict) extends the corpus with no code change
- [ ] #6 Tier B docs state that Tier A must be green before an agentic run
<!-- AC:END -->
