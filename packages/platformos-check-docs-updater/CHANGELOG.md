# @platformos/theme-check-docs-updater

## 1.0.0

### Minor Changes

- e3a7fb0: A stalled documentation host could hang a lint indefinitely.

  `PlatformOSLiquidDocsManager.setup()` compares the local docs revision against the published one, and
  it runs on the first lint of every process. That request had no timeout:

  ```
  lintBuffers -> setup() -> remoteRevision() -> download() -> await fetch(path)
  ```

  A host that accepts the connection and never answers holds the caller for as long as it holds the
  socket — so `pos-cli check`, the language server and the MCP supervisor could all hang on a network
  condition, with no diagnostic and nothing to retry.

  It surfaced as a CI failure: `Integration: lintBuffers > materialises fixes while the app is still
live` timing out at 5000 ms. Reproduced exactly by stalling that one URL and nothing else, and cured
  by bounding it — the same test then passes while the host is still stalled, because `setup()` already
  treats a failed refresh as staleness rather than breakage and keeps the docset on disk.

  **One bound for every request, chosen from measurement rather than from the shape of the data.** The
  first version of this change had two — a tight bound for the revision check and a generous one for
  bulk downloads, on the assumption that a large file needs longer. Measured against the live host, the
  largest resource (the 363 KB GraphQL schema) fetches in ~230 ms and the tiny revision check in
  ~450 ms: latency dominates, size does not, and the second constant was justifying itself with a
  guess. So there is one `DOWNLOAD_TIMEOUT_MS`, generous against ~450 ms and under the budget a caller
  gives a single lint.

  Not a per-platform workaround: the request is bounded everywhere, for every consumer. The CI job that
  failed was ubuntu/node24, but the tests matrix has no `fail-fast: false`, so the other three jobs were
  cancelled rather than passing — the failure depends on whether a runner's request stalls, which any of
  them can hit.

  What this does NOT fix is that a lint reaches the network at all. The docset ships with the package and
  is refreshed at build time by `postbuild`, so for a one-shot lint the revision check is redundant; the
  refresh exists for a long-running language server, which is what `DOCS_MANAGER_MAX_AGE_MS` is for. With
  `fileParallelism: false` and `isolate: true` every spec file forks fresh and pays its own request, so
  the suite depends on a third-party host being reachable. Deciding who should refresh needs a seam the
  manager does not have today — it takes only a `Logger` — and is filed rather than patched around here.

### Patch Changes

- Updated dependencies [a8f4da9]
- Updated dependencies [a8f4da9]
- Updated dependencies [cf80cfa]
- Updated dependencies [8f1beea]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [7e7f1cd]
- Updated dependencies [a8f4da9]
- Updated dependencies [4567a07]
- Updated dependencies [a8f4da9]
- Updated dependencies [cf80cfa]
- Updated dependencies [f15573d]
- Updated dependencies [cf80cfa]
- Updated dependencies [d7374a8]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [280a66f]
- Updated dependencies [e3a7fb0]
- Updated dependencies [cf80cfa]
- Updated dependencies [a8f4da9]
- Updated dependencies [280a66f]
- Updated dependencies [4b6e0aa]
- Updated dependencies [c0907ab]
- Updated dependencies [f15573d]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
  - @platformos/platformos-check-common@1.0.0

## 0.0.19

### Patch Changes

- Improved checks
- Updated dependencies
  - @platformos/platformos-check-common@0.0.19

## 0.0.18

### Patch Changes

- Additional checks and improvements
- Updated dependencies
  - @platformos/platformos-check-common@0.0.18

## 0.0.17

### Patch Changes

- Updated dependencies
  - @platformos/platformos-check-common@0.0.17

## 0.0.16

### Patch Changes

- Improved Liquid Linting
  - Better metadata params validation — Reworked detection of undefined variables in page/partial metadata parameters, reducing false positives
  - Improved undefined object detection — More accurate identification of undefined objects in Liquid templates
  - Fixed invalid property detection — The unknown-property check now correctly catches more cases of invalid property access on objects

- Updated dependencies
  - @platformos/platformos-check-common@0.0.16

## 0.0.15

### Patch Changes

- ctrl+click fix
- Updated dependencies
  - @platformos/platformos-check-common@0.0.15

## 0.0.14

### Patch Changes

- better ctrl click, more checks
- Updated dependencies
  - @platformos/platformos-check-common@0.0.14

## 0.0.13

### Patch Changes

- **MissingRenderPartialArguments**: Reports an error when required `@param` arguments declared in a partial's LiquidDoc are not provided at the `{% render %}` call site.
- **NestedGraphQLQuery**: Detects N+1 query patterns — `{% graphql %}` tags inside `{% for %}`/`{% tablerow %}` loops. Also follows `{% function %}` and `{% render %}` calls transitively to detect indirect GraphQL queries. Skips loops wrapped in `{% cache %}` or `{% background %}`.
- Added **GraphQLFieldCompletionProvider**: Provides completions for GraphQL field names.
- Added **GraphQLFieldHoverProvider**: Shows hover documentation for GraphQL fields.
- Added `theme_render_rc` as a new document type, enabling the `{% theme_render_rc %}` tag to resolve partials through configurable `theme_search_paths` defined in `app/config.yml`.
- **DocumentsLocator**: New `locateWithSearchPaths()` method resolves partials using prioritized search paths, including dynamic paths with `{{ }}` Liquid expressions that expand by enumerating subdirectories.
- **loadSearchPaths()**: New utility to read and parse `theme_search_paths` from `app/config.yml`.
- **TranslationKeyExists**: Refactored to load all defined keys (app-level and module-level) in a single pass. Now suggests nearest matching keys using Levenshtein distance when a translation key is not found.
- Extracted shared translation utilities into `translation-utils.ts` for module discovery and key loading.
- Added `levenshtein.ts` utility for fuzzy key matching.
- Added support for `{% try %}...{% catch error %}` — the error variable in catch branches is now correctly registered as defined, preventing false-positive "undefined object" warnings.
- `null`/`nil` literals are now treated as compatible with any `@param` type, preventing false type-mismatch errors when passing null values to partials.
- `recursiveReadDirectory` now gracefully handles `ENOENT` errors instead of crashing when a directory doesn't exist.
- **MissingPartial** check updated to support `theme_render_rc` tag resolution through search paths.
- Extracted `tryExtractAssignUrl()` helper to deduplicate assign-to-URL resolution logic shared between `MissingPage` check and `buildVariableMap`.
- Fixed `buildVariableMap` to correctly recurse into block tags (`{% if %}`, `{% for %}`) whose position spans beyond the cursor offset — previously assigns inside such blocks could be missed.
- **SearchPathsLoader**: Now caches `theme_search_paths` per root URI to avoid re-reading `app/config.yml` on every request. Invalidated when file watchers detect config changes.
- Immediate cache invalidation on `app/config.yml` save (via `onDidSaveTextDocument`) so go-to-definition doesn't see stale data.
- Bulk file-watcher threshold extracted to `BULK_PAGE_CHANGE_THRESHOLD` constant.
- **RouteTable**: Added `routeCount()` method returning total number of route entries.
- Route table build errors are now properly handled — a failed build resets the cached promise so subsequent attempts can retry.
- `MissingPartial` check simplified with a shared `reportIfMissing()` helper, reducing code duplication across `RenderMarkup`, `FunctionMarkup`, and `GraphQLMarkup` visitors.
- AST traversal helpers (`getTraversableChildren`, `getTraversableMarkup`) extracted in `url-helpers.ts`.
- `MissingPage` check front-loads route table building in `onCodePathStart` instead of lazy-loading per element visit.
- Updated dependencies
  - @platformos/platformos-check-common@0.0.13

## 0.0.12

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.12

## 0.0.11

### Patch Changes

- @platformos/platformos-check-common@0.0.11

## 0.0.10

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.10

## 0.0.9

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.9

## 0.0.8

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.8

## 0.0.7

### Patch Changes

- Update dependencies
- Updated dependencies
  - @platformos/platformos-check-common@0.0.7

## 0.0.6

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.6

## 0.0.5

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.5

## 0.0.4

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.4

## 0.0.3

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.3

## 0.0.2

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.2
