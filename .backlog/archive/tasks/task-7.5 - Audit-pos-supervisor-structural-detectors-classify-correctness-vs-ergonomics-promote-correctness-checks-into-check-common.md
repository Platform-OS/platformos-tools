---
id: TASK-7.5
title: >-
  Audit pos-supervisor:* structural detectors: classify correctness vs
  ergonomics; promote correctness checks into check-common
status: To Do
assignee: []
created_date: '2026-06-08 09:44'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/structural-warnings.ts
  - packages/platformos-check-common/src/checks/index.ts
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Classify each of the 16 `pos-supervisor:*` structural detectors (`src/core/structural-warnings.ts`, ~991 LOC) as either (a) a CORRECTNESS check that belongs in check-common as a real `CheckDefinition`, or (b) genuinely AGENT-ERGONOMIC intelligence that stays in the supervisor. Promote the (a) set.

## Why
Several structural names collide with existing LSP checks (`pos-supervisor:DeprecatedTag`, `MissingContentForLayout`, `MissingSlug`, `NonGetRenderingPage`), forcing dedup logic (the `existingChecks` set, pipeline step 2c1 "drop upstream ValidFrontmatter rows that collide on line"). If they are correctness checks, they belong in the single source of truth; if they are advisory, they should be clearly namespaced and NOT collide.

## The 16 detectors
HtmlInPage, GraphqlInPartial, GraphqlMultilineInLiquidBlock, MissingReturn, MissingContentForLayout, MissingDocBlock, ShopifyObject, ShopifyTag, DeprecatedTag, InvalidSlug, InvalidLayout, InvalidMethod, NonGetRenderingPage, MissingSlug, InvalidFrontMatter, FilterArgMisuse.

## Scope
- Produce a classification table (correctness vs ergonomic) with rationale per detector.
- For correctness detectors: implement them as check-common CheckDefinitions (with structured fixes) and remove the supervisor duplicate + its dedup handling.
- For ergonomic detectors: keep, ensure clean `pos-supervisor:` namespacing and no collision with LSP check codes.

## Out of scope
- The pipeline shrink itself (task-7.9) — but this task removes a chunk of the dedup steps it depends on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the 16 detectors is classified correctness-vs-ergonomic with documented rationale
- [ ] #2 Correctness detectors are reimplemented as check-common CheckDefinitions and removed from structural-warnings.ts, including their dedup handling
- [ ] #3 Remaining structural warnings carry a clean pos-supervisor: namespace and do not collide with LSP check codes
<!-- AC:END -->
