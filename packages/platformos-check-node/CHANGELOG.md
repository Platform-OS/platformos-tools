# @platformos/theme-check-node

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
  - @platformos/platformos-check-docs-updater@0.0.13

## 0.0.12

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.12
  - @platformos/platformos-check-docs-updater@0.0.12

## 0.0.11

### Patch Changes

- normalize windows path
  - @platformos/platformos-check-common@0.0.11
  - @platformos/platformos-check-docs-updater@0.0.11

## 0.0.10

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.10
  - @platformos/platformos-check-docs-updater@0.0.10

## 0.0.9

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.9
  - @platformos/platformos-check-docs-updater@0.0.9

## 0.0.8

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.8
  - @platformos/platformos-check-docs-updater@0.0.8

## 0.0.7

### Patch Changes

- Update dependencies
- Updated dependencies
  - @platformos/platformos-check-common@0.0.7
  - @platformos/platformos-check-docs-updater@0.0.7

## 0.0.6

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.6
  - @platformos/platformos-check-docs-updater@0.0.6

## 0.0.5

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.5
  - @platformos/platformos-check-docs-updater@0.0.5

## 0.0.4

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.4
  - @platformos/platformos-check-docs-updater@0.0.4

## 0.0.3

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.3
  - @platformos/platformos-check-docs-updater@0.0.3

## 0.0.2

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/platformos-check-common@0.0.2
  - @platformos/platformos-check-docs-updater@0.0.2
