---
id: TASK-7.2
title: >-
  Promote correctness checks into check-common (classify the 16 old structural
  detectors; implement the correctness ones)
status: To Do
assignee: []
created_date: '2026-06-08 10:00'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/salvage/data
  - packages/platformos-check-common/src/checks/index.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Make check-common the single source of truth for correctness. Classify each of the 16 `pos-supervisor:*` detectors from the old `structural-warnings.ts` (recoverable at git f60bc39) as CORRECTNESS or ERGONOMIC, and implement the correctness ones as real `CheckDefinition`s with STRUCTURED fixes.

## The 16 detectors to classify
HtmlInPage, GraphqlInPartial, GraphqlMultilineInLiquidBlock, MissingReturn, MissingContentForLayout, MissingDocBlock, ShopifyObject, ShopifyTag, DeprecatedTag, InvalidSlug, InvalidLayout, InvalidMethod, NonGetRenderingPage, MissingSlug, InvalidFrontMatter, FilterArgMisuse.

## Why
In the old design these collided with real LSP checks and forced dedup logic. If they are correctness, they belong in the engine where editors/CLI get them too; if advisory, they stay in the supervisor (task-7.8) cleanly namespaced. This removes the entire dedup problem by construction.

## Scope
- Produce a classification table (correctness vs ergonomic) with rationale, committed to the ADR/architecture doc.
- Implement correctness detectors as check-common CheckDefinitions with `meta`, visitor logic, and structured `fix`/`suggest`. Reuse the Shopify-contamination data lists (salvaged) where relevant.
- Register them in `src/checks/index.ts`; add per-check unit specs.

## Out of scope
- Ergonomic-only detectors (implemented in the supervisor, task-7.8).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A committed classification table marks each of the 16 detectors correctness-vs-ergonomic with rationale
- [ ] #2 Every correctness detector is a registered check-common CheckDefinition with structured fix/suggest and a passing unit spec
- [ ] #3 Shopify-contamination detection (objects/tags) is data-driven from the salvaged lists
<!-- AC:END -->
