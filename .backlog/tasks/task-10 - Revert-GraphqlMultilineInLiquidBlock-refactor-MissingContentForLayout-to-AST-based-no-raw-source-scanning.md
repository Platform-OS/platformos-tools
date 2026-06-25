---
id: TASK-10
title: >-
  Revert GraphqlMultilineInLiquidBlock + refactor MissingContentForLayout to
  AST-based (no raw-source scanning)
status: Done
assignee:
  - filip
created_date: '2026-06-25 07:02'
updated_date: '2026-06-25 07:06'
labels: []
dependencies: []
references:
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.ts
  - >-
    packages/platformos-check-common/src/checks/graphql-multiline-in-liquid-block/index.ts
  - packages/platformos-check-common/src/checks/index.ts
  - docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md
modified_files:
  - packages/platformos-check-common/src/checks/index.ts
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.ts
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.spec.ts
  - packages/platformos-check-node/configs/all.yml
  - packages/platformos-check-node/configs/recommended.yml
  - docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
Corrects two items from TASK-7.2 (the correctness-check promotion):

1. **Remove `GraphqlMultilineInLiquidBlock`** — it was introduced in this branch but will be implemented a different way. Delete the check, its spec, its registration, and regenerate the check-node factory configs. Update the ADR 002 classification appendix to reflect the revert.

2. **Refactor `MissingContentForLayout`** — the detection (VariableLookup visitor) is already AST-based and fine, but the fix's insertion point uses `context.file.source.search(/<\/body>/i)` — a regex scan over the ENTIRE raw file. That is not how checks in this repo work; checks operate on the parsed AST. Replace the raw-source scan with the AST: capture the `<body>` `HtmlElement` and insert at its `blockEndPosition.start` (before `</body>`); fall back to the document end via `file.ast.position.end` when there is no `<body>`. No behavior change to detection or to the produced fix output — existing specs must stay green.

## Constraints
- Surgical; don't devastate. Keep `MissingContentForLayout`'s existing behavior + spec output identical.
- Additive/no-regression for LSP + check-node consumers; regenerate `configs/all.yml` + `recommended.yml` after removing the graphql check.

## Out of scope
- The new (other-way) implementation of the multiline-graphql detection.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GraphqlMultilineInLiquidBlock check + spec are deleted, its import/registration removed from checks/index.ts, and check-node factory configs (all.yml, recommended.yml) regenerated with no reference to it
- [x] #2 MissingContentForLayout no longer scans raw file content (no context.file.source.search/regex); the fix insertion point is derived from the AST (<body> HtmlElement blockEndPosition, else document end)
- [x] #3 MissingContentForLayout existing specs remain green and produce identical fix output; a spec covers the no-<body> fallback and a <body> with attributes
- [x] #4 ADR 002 classification appendix updated to record the GraphqlMultilineInLiquidBlock revert
- [x] #5 check-common type-check + full test suite pass; LSP consumer (language-server-common) re-verified; prettier clean
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reverted GraphqlMultilineInLiquidBlock and refactored MissingContentForLayout to be fully AST-based.

**Removed GraphqlMultilineInLiquidBlock** (to be re-implemented a different way): deleted `checks/graphql-multiline-in-liquid-block/` (index.ts + index.spec.ts), removed its import + `allChecks` entry from `checks/index.ts`, and regenerated the check-node factory configs (`all.yml`, `recommended.yml`) via the build postbuild — verified no reference remains. Updated the ADR 002 classification appendix (row #1 → REVERTED; net-promotions line → 1 in place).

**Refactored MissingContentForLayout** to stop scanning raw file content. The old fix used `context.file.source.search(/<\/body>/i)` — a regex over the entire raw source. Now:
- Detection unchanged (VariableLookup visitor sets a flag — already AST-based).
- Added an `HtmlElement` visitor that captures the first `<body>` element's `blockEndPosition.start` (the `</body>` location, straight from the parsed AST).
- `onCodePathEnd(file)` inserts the fix at that AST position, or falls back to `file.ast.position.end` when there is no `<body>`. No `context.file.source` / regex anywhere.
- Produced fix output is byte-identical to before, so existing specs stayed green; added a spec proving the AST path handles `<body>` with attributes (where an open-tag-based scan could mis-locate).

**Verification:** check-common type-check clean; missing-content-for-layout spec 7/7; full check-common suite 1034 pass (1037 − 4 deleted graphql-multiline tests + 1 new attributes test); LSP consumer (language-server-common) 465 pass — no regression; configs regenerated; prettier clean on all touched files.
<!-- SECTION:FINAL_SUMMARY:END -->
