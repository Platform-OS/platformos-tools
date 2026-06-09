---
id: TASK-7.2
title: >-
  Promote correctness checks into check-common (classify the 16 old structural
  detectors; implement the correctness ones)
status: Done
assignee:
  - filip
created_date: '2026-06-08 10:00'
updated_date: '2026-06-09 18:49'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/salvage/data
  - packages/platformos-check-common/src/checks/index.ts
modified_files:
  - >-
    packages/platformos-check-common/src/checks/graphql-multiline-in-liquid-block/index.ts
  - >-
    packages/platformos-check-common/src/checks/graphql-multiline-in-liquid-block/index.spec.ts
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.ts
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-node/configs/all.yml
  - packages/platformos-check-node/configs/recommended.yml
  - docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md
  - packages/platformos-mcp-supervisor/ARCHITECTURE.md
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
- [x] #1 A committed classification table marks each of the 16 detectors correctness-vs-ergonomic with rationale (in the ADR / ARCHITECTURE doc)
- [x] #2 The two genuine correctness promotions (GraphqlMultilineInLiquidBlock, MissingContentForLayout) are registered check-common CheckDefinitions with a suggest where safe and a passing unit spec
- [x] #3 Detectors already owned by check-common (DeprecatedTag, InvalidLayout, InvalidMethod, unknown-key InvalidFrontMatter) are documented as drops; no duplicate check is added
- [x] #4 Shopify-contamination (objects/tags) is classified ERGONOMIC (supervisor enrichment over UndefinedObject/UnknownTag, deferred to TASK-8) to avoid recreating the dedup collision; NO Shopify check is added to check-common
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (TASK-7.2 — approved 2026-06-09)

### Classification outcome (evidence-backed; full table → committed to ADR 002 + ARCHITECTURE.md)
- PROMOTE → check-common (correctness, additive): **GraphqlMultilineInLiquidBlock** (silent runtime arg-drop), **MissingContentForLayout** (layout never renders body; file-role via getFileType→Layout).
- DROP — already owned by engine (removes old dedup by construction): DeprecatedTag (deprecated-tag), InvalidLayout + InvalidMethod-enum + unknown-key InvalidFrontMatter (valid-frontmatter).
- ERGONOMIC → supervisor (TASK-8): HtmlInPage, GraphqlInPartial, MissingReturn, MissingDocBlock, InvalidSlug, NonGetRenderingPage, MissingSlug (slug optional in pOS), FilterArgMisuse, ShopifyObject, ShopifyTag (latter two = enrichment/elevation of UndefinedObject/UnknownTag, NOT new checks — avoids collision).

### Implementation
1. `src/checks/graphql-multiline-in-liquid-block/index.ts` (+ index.spec.ts) — port detection from old `classifyGraphqlSourceKind` ('liquid_multiline_truncated'); meta.code GraphqlMultilineInLiquidBlock, severity ERROR; detect graphql tag inside `{% liquid %}` block with the truncation shape; message carries the single-line remedy; add a `suggest` only if a safe reflow is expressible, else message-only (documented).
2. `src/checks/missing-content-for-layout/index.ts` (+ index.spec.ts) — meta.code MissingContentForLayout, severity ERROR; fire only when getFileType(file.uri)===Layout and no `{{ content_for_layout }}` output node exists; `suggest` inserts `{{ content_for_layout }}` before `</body>` if present else at file end.
3. Register both in `src/checks/index.ts` `allChecks`; set docs.recommended appropriately.
4. Commit the full 16-row classification table to `docs/mcp-supervisor/decisions/002-.../README.md` (and/or ARCHITECTURE.md §7.2).

### Verify
- `yarn workspace @platformos/platformos-check-common test` for the two new specs; `yarn workspace @platformos/platformos-check-common type-check`.
- Full `yarn vitest run packages/platformos-check-common` to ensure no regressions in existing checks (recommended-set count etc.).
- prettier on new files.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Classified the 16 old pos-supervisor structural detectors and promoted the genuine correctness ones into check-common as the single source of truth.

**Classification (committed to ADR 002 appendix + pointer in ARCHITECTURE.md):** evidence-backed 16-row table.
- PROMOTE (2): GraphqlMultilineInLiquidBlock, MissingContentForLayout.
- DROP (4, already engine-owned → no duplicate, removes old dedup by construction): DeprecatedTag (deprecated-tag); InvalidLayout, InvalidMethod (enum), unknown-key InvalidFrontMatter (valid-frontmatter).
- ERGONOMIC (10, → TASK-8): HtmlInPage, GraphqlInPartial, MissingReturn, MissingDocBlock, InvalidSlug, NonGetRenderingPage, MissingSlug, FilterArgMisuse, ShopifyObject, ShopifyTag.

**Key decision (user-approved):** Shopify contamination stays ergonomic (supervisor enrichment of the existing UndefinedObject/UnknownTag offenses, TASK-8) rather than new check-common checks — both already collide with engine checks, so promoting them would recreate the dedup problem. This deviated from the original AC#3 wording; AC reworded accordingly.

**Implemented in check-common:**
- `checks/graphql-multiline-in-liquid-block` — ERROR; ports the `classifyGraphqlSourceKind === 'liquid_multiline_truncated'` heuristic (source starts not-`{%` + trailing comma + next-line `name:`). Detects silent runtime arg-drop. Message carries the single-line remedy; no autofix (a safe reflow isn't expressible). 4 specs (truncated→fires; tag form, no-comma, comma-without-named-arg → clean).
- `checks/missing-content-for-layout` — ERROR; gated to layouts via `isLayout(file.uri)`; AST-based — any `content_for_layout` VariableLookup (output, `echo`, or inside `{% liquid %}`) clears it; `suggest` inserts before `</body>` else at EOF. 6 specs incl. file-role gate + echo detection + both suggestion branches.
- Registered both in `checks/index.ts` (recommended: true).
- Regenerated check-node factory configs (`all.yml`, `recommended.yml`) via the build's postbuild; `nothing.yml` correctly unchanged (no per-check list).

**Verification:** check-common type-check clean; full check-common suite 1037/1037 pass; check-node 95/95 pass; repo-wide grep confirmed no other consumer pins the check set / recommended count. Prettier-clean.
<!-- SECTION:FINAL_SUMMARY:END -->
