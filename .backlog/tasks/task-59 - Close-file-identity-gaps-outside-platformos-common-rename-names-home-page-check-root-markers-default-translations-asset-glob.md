---
id: TASK-59
title: >-
  Close file-identity gaps outside platformos-common (rename names, home-page
  check, root markers, default translations, asset glob)
status: Done
assignee:
  - '@claude'
created_date: '2026-08-05 10:05'
updated_date: '2026-08-05 10:35'
labels:
  - platformos-common
  - language-server
  - check-common
  - correctness
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A review after the lazy-App PR (#90) found five places where packages other than platformos-common still identify platformOS files themselves, in the guard's documented blind spots (name derivation, fixed files, root markers, single-segment dirs). Each misidentifies files today:

1. `platformos-language-server-common/src/utils/uri.ts` `partialName`/`assetName` use `path.basename(uri, '.liquid')`, flattening nested and module logical names (`ui/card` → `card`, `js/app.js` → `app.js`). Consumers: PartialRenameHandler, AssetRenameHandler, LiquidVariableRenameProvider — renames miss real call sites or rewrite a different file's references.
2. `platformos-check-common/src/checks/valid-frontmatter/index.ts:35` flags any file named `home.html.liquid` (partials, emails, nested pages) and misses `home.liquid` pages — should gate on fileType === Page and logical name 'home'.
3. `platformos-check-common/src/find-root.ts` root markers omit the legacy `marketplace_builder/` root (APP_ROOTS in platformos-common keeps it deliberately); legacy projects without .pos/config resolve no root — LSP and graph CLI dead. APP_ROOTS is not exported yet.
4. `platformos-check-common/src/context-utils.ts:97,116` hardcode `app/translations/en.yml`; misses marketplace_builder root and the split-file layout (`translations/en/*.yml`) that TranslationProvider already supports — translation checks silently get {}.
5. `platformos-language-server-common/src/server/startServer.ts:305` file-operation filter `'**/assets/*'` — single `*` does not cross `/`, so nested asset renames never reach onDidRenameFiles; 'assets' spelling should derive from FILE_TYPE_DIRS via an exported glob.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Renaming a nested or module partial (e.g. views/partials/ui/card.liquid) updates {% render 'ui/card' %} call sites and leaves any top-level 'card' partial's call sites untouched; asset and doc-param renames use logical names the same way (unit tests cover nested + module cases)
- [x] #2 ValidFrontmatter's home deprecation fires only for Page files whose logical name is 'home' (including home.liquid), and not for partials/emails/nested pages named home.html.liquid (tests cover all four)
- [x] #3 findRoot recognizes a project rooted at marketplace_builder/ without .pos or config, without spelling the root name outside platformos-common (APP_ROOTS or equivalent exported)
- [x] #4 Default translations load for marketplace_builder-rooted projects and for the split-file layout app/translations/en/*.yml, via TranslationProvider (tests cover both layouts)
- [x] #5 Renaming a nested asset (app/assets/js/app.js) reaches the asset rename handler: file-operation glob derives from FILE_TYPE_DIRS and matches nested paths
- [x] #6 Full build + test pass across the monorepo (NPM_TOKEN=dummy yarn build && yarn test)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. platformos-common: export APP_ROOTS; add getAppPathsAcrossRoots(type); add ASSET_FILE_OPERATION_GLOB (derived from FILE_TYPE_DIRS[Asset]); add isDeprecatedHomeAlias to route-table/slugFromFilePath (shares the extension-stripping with slugFromFilePath).
2. check-common: find-root.ts markers from APP_ROOTS/MODULE_ROOTS; context-utils default translations via TranslationProvider over getAppPathsAcrossRoots(Translation); ValidFrontmatter home check gated on fileType===Page + isDeprecatedHomeAlias(parseModulePrefix(pathToName(rel).name).key).
3. language-server-common: utils/uri partialName/assetName = pathToName-based, (uri, rootUri) signature, type-gated; update 3 call sites (PartialRenameHandler, AssetRenameHandler, LiquidVariableRenameProvider); startServer file-operation filter uses ASSET_FILE_OPERATION_GLOB.
4. Specs: new find-root.spec; isDeprecatedHomeAlias cases; getAppPathsAcrossRoots + glob pins; home-deprecation matrix (page/nested/partial/module/home.liquid); context-utils marketplace_builder + split-layout; nested+module partial rename; nested asset rename; asset .liquid-name corrections.
5. Changeset + docs-repo update; full build + test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All five fixes implemented and unit-verified; full-suite run in progress (AC #6 pending).

Decisions worth keeping:
- Asset names keep the FULL filename, `.liquid` included — verified against the backend: `asset_parser.rb`'s AssetName strips only `{app,marketplace_builder}/assets/` or the module prefix. The old handler (and its spec) stripped `.liquid` — Shopify semantics; both corrected, plus a test pinning that a `.liquid`-stripped reference names a DIFFERENT asset and is not rewritten.
- Module pages named `home` DO serve the root route: `page.rb` derives the slug from the path after `views/pages/`, module prefix gone — so the check strips the module marker (parseModulePrefix) before asking isDeprecatedHomeAlias.
- The check derives the page name via pathToName(context.toRelativePath(uri)) rather than file.name: onCodePathStart's declared param type is SourceCode<T>, not TypedAppFile<T>, even though the engine always passes AppFiles. Widening the check API to TypedAppFile (making name/fileType/relativePath available to checks) is a candidate follow-up.
- getDefaultLocaleFile (single-URI consumer: startServer's getDefaultLocaleSourceCode → DefinitionProvider) now probes both roots, but still answers undefined for a split-layout project (no single en.yml) — same degradation as before, needs an API change to fix; out of scope.
- Docs repo updated: valid-frontmatter.liquid home bullet rewritten for the new semantics.

Final full-suite run: 308/308 test files, 3026/3026 tests passing. The only fallout from the fixes was startServer.spec's deliberate literal pin of the file-operation globs — updated to '**/assets/**' with a comment on why the single '*' was a bug.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the five file-identity gaps outside platformos-common found by the post-#90 review — each was classifying or naming platformOS files locally, in the directory-name guard's documented blind spots, and each misidentified files.

**What changed**

- **platformos-common** (minor): exported `APP_ROOTS`; added `getAppPathsAcrossRoots(type)` (every app root, legacy included — for locating what a project HAS, vs `getAppPaths` for naming what to create); added `ASSET_FILE_OPERATION_GLOB` (`**/assets/**`, derived from `FILE_TYPE_DIRS`); added `isDeprecatedHomeAlias` to the route-table, sharing the extension-stripping with `slugFromFilePath`.
- **check-common** (patch): `findRoot` markers now derive from `APP_ROOTS`/`MODULE_ROOTS` — a bare `marketplace_builder/` project resolves a root (previously: no LSP, no graph CLI, silently). `getDefaultTranslations`/`getDefaultLocaleFile` go through `TranslationProvider` over `getAppPathsAcrossRoots(Translation)` — legacy root and split `en/*.yml` layout both load (previously `{}`). `ValidFrontmatter`'s home deprecation gates on fileType === Page + `isDeprecatedHomeAlias` of the module-stripped logical name — module pages included (backend derives slug after `views/pages/`), partials/emails/nested pages excluded, `home.liquid` covered.
- **language-server-common** (patch): `partialName`/`assetName` resolve through `pathToName(relative(uri, root))`, type-gated — nested (`ui/card`) and module (`modules/community/card`) renames now hit their real call sites instead of a same-basename file's. Asset names keep the FULL filename incl. `.liquid` (verified against `asset_parser.rb`'s AssetName; the stripping was Shopify semantics). The file-operation filter uses `ASSET_FILE_OPERATION_GLOB` — nested asset renames reach the handler at all.

**Tests**: new find-root.spec (8 cases incl. both legacy-root cases); isDeprecatedHomeAlias matrix; getAppPathsAcrossRoots + glob pins; home-deprecation matrix (page/home.liquid/module/nested/partial/index/homepage); context-utils legacy-root + split-layout + locale-file-URI; nested+module partial rename with same-basename control; nested asset rename; corrected the two Shopify-semantics asset specs and added a "stripped spelling names a different asset" control. Full monorepo: 308 files / 3026 tests green.

**Also**: changeset `.changeset/file-identity-gaps.md`; ValidFrontmatter docs page updated in platformos-documentation (home bullet rewritten for the new semantics).

**Follow-ups proposed (not created)**: widen the check API so lifecycle hooks/context expose `TypedAppFile` (name/fileType/relativePath) instead of `SourceCode`; single-URI `getDefaultLocaleFileUri` still returns undefined for split-layout projects (pre-existing degradation, needs an API change).
<!-- SECTION:FINAL_SUMMARY:END -->
