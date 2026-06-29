---
id: TASK-7.4
title: >-
  Consolidate fix infrastructure: reuse check-common correctors/FixDescription
  instead of regenerating fixes
status: To Do
assignee: []
created_date: '2026-06-08 09:44'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/fix-generator.ts
  - packages/platformos-check-common/src/fixes
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Stop regenerating fixes from scratch in the supervisor. Where check-common already emits a structured `fix`/`suggest` for an offense, surface THAT to the agent (translated to the supervisor `Fix` union for prose/agent ergonomics) instead of re-deriving the edit in `fix-generator.ts`.

## Why
`src/core/fix-generator.ts` is ~1.7k LOC (18 per-check fix functions) — much of it duplicates fixes check-common can already express via `StringCorrector`/`JSONCorrector` + `FixDescription` (strip `lib/` prefix, include->render, did-you-mean filter, etc.). Two fix implementations will drift.

## Scope
- Map check-common `FixDescription` -> supervisor `Fix` (`TextEditFix`/`InsertFix`/`CreateFileFix`/`GuidanceFix`/`AddDocParamFix`).
- Delete per-check fix functions whose output is now sourced from check-common.
- Keep ONLY genuinely supervisor-specific fixes (those backing `pos-supervisor:*` structural warnings with no check-common equivalent — pending task-7.5 classification) and agent-ergonomic transforms (coalescing `add_doc_param`, `unified_fix` clustering descriptions).

## Out of scope
- Clustering/scorecard logic (kept; ergonomic).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Fixes for checks that check-common already fixes are sourced from check-common FixDescription, not regenerated
- [ ] #2 fix-generator.ts shrinks materially; remaining fix code is either pos-supervisor:* structural or agent-ergonomic, and that split is documented
- [ ] #3 Fix-related parity baselines pass or are intentionally re-recorded
<!-- AC:END -->
