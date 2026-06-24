---
id: TASK-7.9
title: >-
  Shrink the orchestrator and ordered pipeline: remove suppress*/verify*OnDisk
  steps made redundant by structured + full-context linting
status: To Do
assignee: []
created_date: '2026-06-08 09:45'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/diagnostic-pipeline.ts
  - packages/platformos-mcp-supervisor/src/tools/validate-code.ts
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Reduce the 1,227-LOC orchestrator (`validate-code.ts`) and the 15-step "load-bearing ordered" pipeline (`diagnostic-pipeline.ts`, ~1,071 LOC) now that linting runs directly with full project context and structured offenses.

## Why
Many pipeline steps exist to PATCH context the in-process LSP lacked. Steps 9-13 (`verifyMissingAssets`, `verifyTranslationKeysOnDisk`, `verifyPageRoutesOnDisk`, `verifyOrphanedPartialOnDisk`, `verifyMissingPartialsOnDisk`) cross-check diagnostics against disk to suppress false positives the LSP produced without full project context. When check-common runs directly with the project AbstractFileSystem + platformos-graph (task-7.6), those false positives should not arise, so the verify/suppress steps become unnecessary. The pipeline should trend toward a small, order-INDEPENDENT enrichment set.

## Scope
- For each of the 15 steps, determine whether it is still needed once linting is structured + full-context. Remove the ones that only corrected LSP-context gaps.
- Re-examine the suppressLspKnownFalsePositives / suppressDocParams / suppressUnusedDocParams steps (LSP cache-lag workarounds) — likely removable.
- Reduce "ordering is load-bearing" coupling where steps are now independent; document any ordering that genuinely remains.
- Keep ergonomic steps (elevateShopify, clustering inputs, confidence stamping).

## Out of scope
- BLOCKING_WARNINGS semantics (kept) unless a member moved into check-common via task-7.5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pipeline steps that only corrected LSP-context gaps (the verify*OnDisk family and LSP cache-lag suppressions) are removed, with per-step rationale recorded
- [ ] #2 Remaining pipeline ordering dependencies are documented; steps that became order-independent no longer rely on position
- [ ] #3 validate-code.ts and diagnostic-pipeline.ts shrink materially; parity/integration suites pass or are intentionally re-baselined
<!-- AC:END -->
