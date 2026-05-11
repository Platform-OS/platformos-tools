---
id: TASK-6
title: Full build + test pass; fix downstream fallout
status: To Do
assignee: []
created_date: '2026-05-11 13:12'
labels: []
dependencies:
  - TASK-4
  - TASK-5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After tasks 1–5 land, run the full monorepo build and test suite, and fix any breakage caused by:

- Stricter regex (extension-anchored) classification
- `marketplace_builder/` removal — any fixture, snapshot, or spec using that root must be migrated to `app/` or deleted
- `DocumentManager.app()` now filtering graphql/yaml strictly — LSP specs may have fixtures in non-canonical dirs

**Commands:**
```bash
NPM_TOKEN=dummy yarn build
NPM_TOKEN=dummy yarn test
yarn type-check
```

**Likely fallout to expect:**
- `platformos-language-server-common/src/**/*.spec.ts` — fixtures may use `marketplace_builder/` paths
- `platformos-check-common/src/**/*.spec.ts` — likewise
- Snapshot mismatches from the URI-classification change

**Files (anticipated, not exhaustive):**
- Anything that grep `marketplace_builder` still finds under `packages/`
- Anything that grep `isKnownLiquidFile\|isKnownGraphQLFile\|isKnownYAMLFile` outside path-utils still finds (might be more callers we missed)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 yarn build succeeds with zero TypeScript errors
- [ ] #2 yarn test passes (all 239 test files, 1576+ individual tests)
- [ ] #3 yarn type-check passes
- [ ] #4 grep -rn marketplace_builder packages/ --include=*.ts returns no live (non-comment) hits
<!-- AC:END -->
