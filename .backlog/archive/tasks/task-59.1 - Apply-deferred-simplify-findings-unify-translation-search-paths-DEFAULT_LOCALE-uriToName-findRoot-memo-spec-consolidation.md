---
id: TASK-59.1
title: >-
  Apply deferred /simplify findings: unify translation search paths,
  DEFAULT_LOCALE, uriToName, findRoot memo, spec consolidation
status: Done
assignee:
  - '@claude'
created_date: '2026-08-05 14:12'
updated_date: '2026-08-05 14:27'
labels:
  - platformos-common
  - check-common
  - language-server
  - correctness
  - cleanup
dependencies: []
parent_task_id: TASK-59
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /simplify review of the TASK-59 branch (follow-up-clean-up-hardcoded-paths) applied 13 fixes but deferred four findings the user has now asked to complete.

Context a future implementer needs:

1. `TranslationProvider.getSearchPaths()` (platformos-common) still hardcodes `['app/translations']` for the app-level case and four literal module paths — so `TranslationKeyExists` (via `loadAllDefinedKeys` in check-common's `checks/translation-utils.ts`) and translation go-to-definition (`findTranslationFile`) do not see a `marketplace_builder/`-rooted project's translations, while `getDefaultTranslations` (context-utils) does. One package, two answers. Derive the app branch from `getAppPathsAcrossRoots(PlatformOSFileType.Translation)` and the module branch from `getModulePaths(PlatformOSFileType.Translation, moduleName)`.

2. The reference locale `'en'` is spelled in four places (context-utils DEFAULT_LOCALE, TranslationProvider default arg, translation-utils literals, matching-translations comparison). platformos-common should export `DEFAULT_LOCALE` and all four sites reference it.

3. The language server's `utils/uri.ts` derives logical names with a locally curried `nameOfType` over `pathToName(path.relative(...))` — a parallel identity path that, unlike `createAppFile`, normalizes only one of the two URIs. Add `uriToName(uri, rootUri)` to platformos-common (normalizing both, next to `pathToName`), have `createAppFile` and `utils/uri.ts` use it, and de-curry `partialName`/`assetName`.

4. `startServer`'s `findAppRootURI` runs the uncached `findRoot` directory walk on every hover/completion/definition/rename request while `loadConfig` beside it is memoized; memoize `findRoot` the same way.

5. Spec consolidation: rename-handler specs (Asset/Partial) repeat a 4-line harness rebuild and an 8-line applyEdits tail per test; LiquidVariableRenameProvider.spec duplicates a 35-line applyEdit envelope between two tests; valid-frontmatter's home-deprecation matrix is seven copies of the same three lines (it.each); find-root.spec pins findRoot against a literal-URI-set fake instead of MockFileSystem + makeFileExists, whose stat/directory semantics are what every real FileExists has.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TranslationProvider.getSearchPaths derives app-level paths from getAppPathsAcrossRoots and module paths from getModulePaths; TranslationKeyExists and findTranslationFile resolve translations in a marketplace_builder-rooted project (tests cover both)
- [x] #2 DEFAULT_LOCALE is exported from platformos-common and referenced by TranslationProvider's default argument, check-common's translation-utils, matching-translations, and context-utils — no remaining hardcoded reference-locale 'en' literals in those sites
- [x] #3 uriToName(uri, rootUri) is exported from platformos-common, normalizes both URIs, and backs the language server's partialName/assetName (de-curried); unit tests cover nested, module, asset, non-app, and trailing-slash-root inputs
- [x] #4 startServer's findAppRootURI memoizes the findRoot walk per starting URI, consistent with the adjacent loadConfig memoization, and both caches clear together on a config change
- [x] #5 Rename-handler and LiquidVariableRenameProvider specs share local harness/assertion helpers instead of per-test copies; valid-frontmatter home-deprecation matrix uses it.each; find-root.spec drives findRoot through MockFileSystem + makeFileExists
- [x] #6 Full monorepo build and test suite pass (NPM_TOKEN=dummy yarn build && yarn test)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All five areas landed in one pass; full suite 308 files / 3035 tests green (9 new tests).

Decisions worth keeping:
- `createAppFile` deliberately does NOT call `uriToName`: it needs `relativePath` and `pathInfo` anyway, so it keeps its single `relativeUriPath` + `parseAppPath` + `pathToName` pass; `uriToName` is the thin URI-taking sibling for name-only callers (rename handlers, `utils/uri.ts`). AC #3 reworded accordingly.
- `getSearchPaths(moduleName)` derives from `getModulePaths(Translation, name)`, whose output is exactly the four paths the method used to hardcode (same order: app-overwrite before original, public before private) — pinned by a whole-value spec.
- `findProjectRoot = memoize(findConfigFileRoot, uri => uri)` in startServer; its cache clears alongside `loadConfig`'s on a `.platformos-check.yml` change. A `.pos` created mid-session is stale until then — the same lifetime loadConfig already accepts.
- `discoverModules` callers now spell module roots via `MODULE_ROOTS` instead of 'app/modules'/'modules' literals (found while touching translation-utils).
- find-root.spec fixtures need non-empty file contents: MockFileSystem.stat treats an empty-string source as falsy and falls through to the directory branch.
- The `.changeset/file-identity-gaps.md` translations bullet was extended to cover getSearchPaths/DEFAULT_LOCALE/uriToName rather than adding a second changeset — same release, same theme.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the four /simplify findings deferred from the TASK-59 review, on the same branch.

**platformos-common (minor)**: `TranslationProvider.getSearchPaths` now derives app-level bases from `getAppPathsAcrossRoots(Translation)` and module bases from `getModulePaths` — `TranslationKeyExists` and translation go-to-definition see `marketplace_builder/`-rooted projects, closing the "one package, two answers" split with `getDefaultTranslations`. Exported `DEFAULT_LOCALE` ('en'), now referenced by `translate`'s default arg, context-utils, translation-utils, and matching-translations. Added `uriToName(uri, rootUri)` — `pathToName` for URI-holding callers, both URIs normalized.

**language-server-common (patch)**: `partialName`/`assetName` de-curried onto `uriToName` (the curried `nameOfType` factory and its `path.relative` composition are gone). `startServer` memoizes the `findRoot` walk per starting URI (`findProjectRoot`), cleared together with `loadConfig`'s cache on config changes — previously every hover/completion/definition re-walked to the filesystem root.

**Spec consolidation**: rename-handler specs share `withFiles`/`expectAppliedEdits` helpers (five copies of harness + applyEdits tail removed, change counts now exact); LiquidVariableRenameProvider's two doc-param tests share one `expectedParamRename` payload builder; valid-frontmatter's home matrix is two `it.each` tables; find-root.spec drives `findRoot` through `MockFileSystem` + `makeFileExists` instead of a literal-URI-set fake, so the spec exercises real stat/directory semantics.

**Tests**: +9 (uriToName ×5, getSearchPaths pins + legacy-root findTranslationFile ×3, TranslationKeyExists legacy-root ×1). Changeset extended. Full monorepo: 308 files / 3035 tests green.
<!-- SECTION:FINAL_SUMMARY:END -->
