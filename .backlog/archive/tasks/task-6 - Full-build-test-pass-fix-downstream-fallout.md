---
id: TASK-6
title: Full build + test pass; fix downstream fallout
status: Done
assignee: []
created_date: '2026-05-11 13:12'
updated_date: '2026-08-07 12:51'
labels: []
dependencies: []
ordinal: 6000
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS OBSOLETE 2026-08-07 — meta-task for TASK-1 … TASK-5

A build-and-fix-fallout pass for an epic that is now closed: its parts were either
delivered by other work or deliberately reversed. The two fallout classes it anticipated
are both moot — `marketplace_builder/` fixtures did not need migrating because the root
was kept, and the strict-classification fallout landed incrementally with the work that
introduced it.

The repo currently builds clean and the whole suite passes (361 files / 3859 tests as of
2026-08-07), so there is no outstanding fallout to fix.
<!-- SECTION:NOTES:END -->
