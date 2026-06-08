---
id: TASK-7.7
title: >-
  Build the pure enrichment core: hints, confidence, FixDescription -> agent
  Fix, see_also
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
labels: []
dependencies:
  - TASK-7.5
  - TASK-7.6
references:
  - packages/platformos-check-common/src/fixes
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement `enrich/` as a PURE function `(StructuredDiagnostic[], ProjectContext, Knowledge) -> EnrichedDiagnostic[]`. No I/O, no message parsing — it reads typed fields off the structured diagnostic.

## Scope
- Attach a hint (from the knowledge layer, keyed by check code + optional variant) to each diagnostic.
- Confidence assignment (static, rule/heuristic-based; analytics layer explicitly out of scope).
- Fix translation: map check-common `FixDescription` -> the agent-facing `Fix` shape. Do NOT regenerate edits that the engine already produced.
- `see_also` / gotcha linking from data.
- Optional graph-aware "did you mean?" using platformos-graph queries (e.g. nearest partial) — via the shared graph, not a bespoke one.

## Why pure
Enrichment is the bulk of the logic and must be unit-testable without booting anything. All I/O already happened in lint/ (task-7.6).

## Out of scope
- Whole-result transforms (clustering/scorecard) — task-7.9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 enrich/ is a pure function with no node:fs / process / I/O imports (task-7.1 purity guard passes)
- [ ] #2 Agent fixes are translated from check-common FixDescription, not regenerated from scratch
- [ ] #3 Hints attach by check code via the knowledge layer; unit tests pin enrichment output for representative diagnostics
<!-- AC:END -->
