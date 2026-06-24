---
id: TASK-7.7
title: >-
  Replace FiltersIndex/ObjectsIndex/TagsIndex with check-common's
  AugmentedPlatformOSDocset
status: To Do
assignee: []
created_date: '2026-06-08 09:45'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/filters-index.ts
  - packages/platformos-check-common/src/AugmentedPlatformOSDocset.ts
parent_task_id: TASK-7
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Drop the supervisor's parallel docset wrappers (`filters-index.ts`, `objects-index.ts`, `tags-index.ts`) and consume check-common's `AugmentedPlatformOSDocset` directly for filter/object/tag lookups and "did you mean" suggestions.

## Why
The supervisor reuses the docset DATA (same `PlatformOSLiquidDocsManager` JSON) but reimplements the wrapping. `AugmentedPlatformOSDocset` already provides memoization, alias expansion, normalization of inconsistent `deprecated` entries, and undocumented-entry injection — the supervisor indexes re-do a subset of this and will drift from the canonical augmentation.

## Scope
- Point enrichment/fix suggestion lookups at AugmentedPlatformOSDocset.
- Remove FiltersIndex/ObjectsIndex/TagsIndex (or reduce to thin adapters if a supervisor-only lookup shape is genuinely needed).
- Keep Shopify-contamination detection (data-driven, supervisor-specific) — only the docset wrapping is shared.

## Out of scope
- Shopify contamination data (`data/shopify-*.json`) stays in the supervisor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Filter/object/tag lookups and did-you-mean suggestions use AugmentedPlatformOSDocset
- [ ] #2 filters-index.ts / objects-index.ts / tags-index.ts are removed or reduced to thin adapters
- [ ] #3 Suggestion-related parity baselines pass
<!-- AC:END -->
