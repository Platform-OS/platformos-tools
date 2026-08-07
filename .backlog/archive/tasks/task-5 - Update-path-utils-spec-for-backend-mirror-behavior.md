---
id: TASK-5
title: Update path-utils spec for backend-mirror behavior
status: Done
assignee: []
created_date: '2026-05-11 13:10'
updated_date: '2026-08-07 12:51'
labels: []
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewrite `packages/platformos-common/src/path-utils.spec.ts` to assert the new (stricter, backend-exact) semantics.

**Remove:**
- The entire `describe('marketplace_builder/ legacy root', ...)` block.
- All other `marketplace_builder/...` assertions sprinkled through other describes (search for the literal string).

**Add coverage for new behavior:**
- Wrong-extension rejection now that the regex includes the extension suffix:
  - `app/translations/en.json` → `getFileType` undefined
  - `app/graphql/x.txt` → undefined
  - `app/transactable_types/x.yml.bak` → undefined
  - `app/authorization_policies/x.txt` → undefined
- Scalar patterns (from task 2):
  - `config.yml`, `app/config.yml` → `InstanceConfig`
  - `user.yml`, `app/user.yml` → `UserType`
  - `app/asset_manifest.json` → `AssetManifest`
  - `app/assets.json`, `modules/core/public/assets.json` → `AssetsManifest`
  - `pos-modules.lock.json`, `app/pos-modules.lock.json`, `pos-module.lock.json` → `ModulesLock`
- ActivityStreams:
  - `app/activity_streams/handlers/x.yml` → `ActivityStreamsHandler`
  - `app/activity_streams/grouping_handlers/x.yml` → `ActivityStreamsGroupingHandler`
  - Module versions of the same
- Page/InstanceView with non-`.liquid` extension:
  - `app/views/pages/home.html` → `getFileType` returns `Page`, `isSupportedSourceFile` returns `false`
- Asset partials in known dirs:
  - `app/views/partials/foo.css.liquid` → `isSupportedSourceFile` returns `false`
  - `app/views/partials/foo.js.liquid` → `isSupportedSourceFile` returns `false`
- Backend quirks (mirror verbatim, document with comment):
  - `app/graphqls/x.graphql` → `GraphQL` (the `s?` quirk)

**Existing spec sections to keep/adjust:**
- `app/ root — *` describes — keep as is
- `module paths` describe — keep
- `app/modules nested paths` describe — keep
- `false positive prevention` describe — keep all cases
- `getAppPaths` / `getModulePaths` describes — keep
- Convenience predicates — drop the `marketplace_builder/...` assertions inside them

**Files:**
- `packages/platformos-common/src/path-utils.spec.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All marketplace_builder/ assertions removed
- [ ] #2 Scalar-pattern, ActivityStreams, wrong-extension, asset-partial, and Page-non-liquid cases added
- [ ] #3 yarn workspace @platformos/platformos-common test passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS OBSOLETE 2026-08-07 — its central instruction was reversed

This task's main ask was to delete the `marketplace_builder` coverage from
`path-utils.spec.ts`. That root was **kept** (see TASK-1), so removing its assertions
would delete tests for live behaviour — the opposite of the intent.

The rest landed by other routes: wrong-extension rejection
(`app/translations/en.json` → `undefined`, `app/graphql/x.txt` → `undefined`) is covered,
because the extension is part of classification via `REFERENCE_EXTENSIONS` and the
anchored `PATH_PATTERNS`. Fixed-path files (`app/config.yml` → `InstanceConfig`,
`app/user.yml` → `UserSchema`) are covered by `fixed-path-files.spec.ts`. The
`AssetManifest` / `AssetsManifest` / `ModulesLock` rows it asks for were never added on
purpose — see TASK-2.
<!-- SECTION:NOTES:END -->
