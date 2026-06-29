---
id: TASK-9.4
title: >-
  Layout-association edges + centralize the Layout type (DocumentsLocator
  'layout' + graph frontmatter→layout edge + missing-content-for-layout)
status: To Do
assignee: []
created_date: '2026-06-24 11:11'
updated_date: '2026-06-24 13:12'
labels: []
dependencies:
  - TASK-9.1
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - packages/platformos-common/src/documents-locator/DocumentsLocator.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - >-
    packages/platformos-check-common/src/checks/missing-content-for-layout/index.ts
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
The 4th edge kind from TASK-9.1 (function/graphql/include done): a page/email declares its wrapper layout in FRONTMATTER (`layout: theme`), not via a Liquid tag, so `platformos-graph` never records the page→layout dependency. Adding it answers "which pages use layout X?" (rename/delete impact), flags a typo'd/missing layout as a missing target, and completes a page's `dependencies`. Lower-value than function/graphql (layouts are already entry-point nodes, so they are not falsely orphaned) — hence a small, separate PR.

Kept separate (small PR) because it is a CROSS-PACKAGE additive change touching `platformos-common` (DocumentsLocator), which the LSP and all checks depend on.

See ADR 003 and TASK-9.1's notes for the analysis.

## Scope

### 1. Add a `'layout'` DocumentType to `DocumentsLocator` (platformos-common) — the canonical resolver
`DocumentType` today is `function | render | include | graphql | asset | theme_render_rc` — no layout. Resolving `layout: theme` needs probing `app/views/layouts/theme.{liquid,html.liquid}` + module variants, which is exactly DocumentsLocator's job. Add it (additive; do NOT hand-roll layout paths in the graph — AC#3):
- add `'layout'` to the `DocumentType` union;
- map `'layout'` to `PlatformOSFileType.Layout` in `getSearchPaths` (reuse existing `FILE_TYPE_DIRS[Layout]` via `getAppPaths`/`getModulePaths`);
- generalize `locateFile`'s extension handling so layouts try `.html.liquid` then `.liquid` (today it hardcodes `.liquid` for partial, `.graphql` for graphql);
- add a `'layout'` case to `locateDefault` for the missing-target fallback (e.g. `app/views/layouts/<name>.liquid`, module-prefix aware).

### 2. Graph: frontmatter→layout edge (platformos-graph `traverse.ts`)
- Add a `YAMLFrontmatter` visitor that parses the node `body` (YAML) and reads `layout`.
- Resolve via `DocumentsLocator(rootUri, 'layout', name)` → `getLayoutModule`/by-uri → `bind` kind `'layout'` (the `ReferenceKind` already includes `'layout'` from TASK-9.1). Missing layout → `exists:false` node (parity with function/graphql).
- Semantics: `layout: ''` → explicitly no layout (no edge); module-prefixed `modules/x/...` handled by DocumentsLocator. DECISION: only EXPLICIT layouts get an edge — do NOT synthesize an edge to the implicit default (`application`) when `layout` is omitted (matches the old supervisor's validateLayout; avoids guessing). Document this.

### 3. Delegate the Layout type in `missing-content-for-layout` (check-common)
`packages/platformos-check-common/src/checks/missing-content-for-layout/index.ts` line 40 currently scopes via the `isLayout(context.file.uri)` convenience predicate. Route it through the canonical Layout type — `getFileType(uri) === PlatformOSFileType.Layout` — so layout-file identification across the toolchain (DocumentsLocator `'layout'`, the graph layout edge, and this check) flows from the single `PlatformOSFileType.Layout` source of truth, not a one-off helper. Behaviour unchanged; the check's existing specs must stay green.

## Constraints
- Additive only; re-verify the LSP consumers (`platformos-language-server-common`: references/dependencies/dead_code) and check-common (valid-frontmatter already has its own `checkLayoutExists` probing — note the duplication; converging it onto the new `locate('layout', …)` is a nice-to-have, not required here).
- TDD; small, reviewable PR.

## Out of scope
- Converging `valid-frontmatter`'s layout probing onto DocumentsLocator (follow-up).
- Entry-point enumeration of unreferenced commands (TASK-9.2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DocumentsLocator supports a 'layout' DocumentType: getSearchPaths maps it to PlatformOSFileType.Layout, locateFile tries .html.liquid then .liquid, and locateDefault has a layout fallback; additive (existing DocumentType behaviour unchanged) with platformos-common unit tests
- [ ] #2 platformos-graph emits a page→layout edge (kind 'layout') from frontmatter `layout`, resolved via DocumentsLocator('layout'); missing layout → exists:false node; `layout: ''` → no edge; only explicit layouts get an edge (documented). Covered by a graph spec/fixture
- [ ] #3 missing-content-for-layout (check-common) scopes layout files via the canonical PlatformOSFileType.Layout type rather than the isLayout predicate; its existing specs remain green
- [ ] #4 Verification: platformos-common + platformos-graph + check-common tests pass; LSP consumer (language-server-common) re-verified green; changes are additive; prettier/type-check clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Add: theme_render_rc edge handling (from TASK-9.1 code review, 2026-06-24)

Deferred here because it needs the same DocumentsLocator render-path routing this task introduces.

**Problem:** the parser maps `{% theme_render_rc %}` to a `RenderMarkup` node (liquid-html-parser stage-2-ast.ts:582-583, 2083), so the graph's `RenderMarkup` visitor catches it and labels it `kind:'render'`, resolving via `getPartialModule` -> `app/views/partials/<name>.liquid`. But `theme_render_rc` resolves through THEME SEARCH PATHS (DocumentsLocator already has a dedicated `'theme_render_rc'` DocumentType). So a theme_render_rc edge is mislabeled `render` and points at a wrong/absent partial path -> wrong dependency/orphan output, disagreeing with the LSP. (The wrong RESOLUTION is pre-existing in the old RenderMarkup visitor; TASK-9.1 added only the `kind:'render'` mislabel. theme_render_rc was out of 9.1's function/graphql/include scope.)

**Fix (alongside layout):** in the graph `RenderMarkup` visitor, branch on the parent tag name: `render`->'render', `include`->'include', `theme_render_rc`->new kind 'theme_render_rc', resolving the latter via `DocumentsLocator(rootUri,'theme_render_rc',name)` (NOT getPartialModule). Add `'theme_render_rc'` to the `ReferenceKind` union in check-common types.ts (additive, like the others). Spec + fixture covering a theme_render_rc edge. Note: theme_render_rc search-path resolution may need `theme_search_paths` from app/config.yml (loadSearchPaths) — confirm whether to thread it in or accept locateDefault fallback.
<!-- SECTION:NOTES:END -->
