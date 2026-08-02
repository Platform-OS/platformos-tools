---
id: TASK-12.20
title: >-
  Graph resolved asset references to a root-level assets/ the platform never
  deploys from
status: Done
assignee: []
created_date: '2026-07-31 20:14'
updated_date: '2026-07-31 20:15'
labels:
  - platformos-graph
  - bug
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FIXED — recorded because the bug shipped, and because the fixture encoded it.

Assets follow exactly the same placement rules as every other platformOS file type:
`app/assets/` or `modules/<name>/{public,private}/assets/` (see
https://documentation.platformos.com/developer-guide/modules/modules). `platformos-graph`
had its own second copy of that rule, and got it wrong:

- `getAssetModule` built `<root>/assets/<name>` — a location the platform does not
  deploy from — so every asset node in the graph pointed at a non-existent file and
  reported `exists: false` on a real project.
- It also ran the reference through `path.basename`, discarding both any subdirectory
  (`styles/theme.css` → `theme.css`) and any `modules/<name>/` prefix, so nested and
  module assets collapsed onto each other.
- `getModule` classified assets as `relativePath.startsWith('assets') ||
  relativePath.startsWith('modules')` instead of asking `getFileType`, which is what
  made the wrong root look self-consistent.

Meanwhile `DocumentsLocator.locate(root, 'asset', name)` resolved the SAME reference
to `app/assets/app.js`. So the graph and the linter disagreed about which file
`{{ 'app.js' | asset_url }}` points at — the precise failure mode the App model's
single-source-of-truth design exists to prevent.

## Fix

- `getAssetModule` resolves through `parseModulePrefix` + `getAppPaths(Asset)` /
  `getModulePaths(Asset, mod)`, keeping the full reference (no `basename`).
- New `getAssetModuleByUri`, following the existing `getPartialModuleByUri` /
  `getGraphQLModuleByUri` precedent: when the URI is already known, do not
  reconstruct a path from a name at all. `getModule` uses it.
- `getModule` classifies via `getFileType(uri) === PlatformOSFileType.Asset`.
- `fixtures/skeleton/assets/` moved to `fixtures/skeleton/app/assets/`. Its two asset
  nodes now report `exists: true`; before the move they were only "correct" because
  the fixture matched the bug.
- `packages/platformos-common/src/app/directory-knowledge.spec.ts` now polices
  `assets` too, so the rule cannot be copied into another package again. Root-agnostic
  watch globs (`'**/assets/*'`) are exempt, since a `**/` prefix matches the directory
  under every legal root and therefore cannot disagree.

## Note for whoever wires the graph into check-node

`getAssetModule` is sync with no filesystem, so for a module-prefixed reference it can
only pick the FIRST candidate path as canonical (the `app/modules/<m>/public` overwrite
slot). Once the graph is handed an `App` (TASK-12.6.5), it should resolve through
`App.find(PlatformOSFileType.Asset, name)` instead, which knows which candidate
actually exists. Note assets are not in the lint's glob today, so the App would need to
collect them first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Asset nodes for a real project point at app/assets or modules/<name>/{public,private}/assets and report exists: true
- [ ] #2 A nested asset (styles/theme.css) and a module-prefixed asset keep their full path rather than being collapsed to a basename
- [ ] #3 The graph and DocumentsLocator resolve the same asset reference to the same URI
- [ ] #4 No package outside platformos-common spells the assets directory except in a root-agnostic watch glob, enforced by directory-knowledge.spec.ts
<!-- AC:END -->
