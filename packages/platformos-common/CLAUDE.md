# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@platformos/platformos-common` is a shared library providing utilities used across the platformOS tools monorepo: file type classification, document/partial location resolution, translation loading, and the `AbstractFileSystem` interface for environment portability.

## Commands

```bash
# Build
yarn build

# Run tests (vitest)
yarn test

# Run a single test file
yarn test src/path-utils.spec.ts

# Type-check without emitting
yarn type-check
```

## Architecture

### `AbstractFileSystem` (`AbstractFileSystem.ts`)

Interface that abstracts filesystem operations (`stat`, `readFile`, `readDirectory`) so the same logic runs in Node.js, the browser, and VS Code. All classes in this package depend on it rather than any concrete `fs` module. Consumers provide an implementation at construction time.

### `path-utils.ts` — File type classification

`FILE_TYPE_DIRS` is the **single source of truth** for all platformOS directory names, mapping each `PlatformOSFileType` enum value to its canonical directory names (including legacy aliases from the server's `converters_config.rb`).

`TYPE_MATCHERS` pre-compiles one regex per type from `FILE_TYPE_DIRS`, matching both app-level paths (`/(app|marketplace_builder)/{dir}/`) and module paths (`/(public|private)/{dir}/`). This design prevents false positives — e.g. `app/lib/smses/file.liquid` resolves to `Partial`, not `Sms`, because `/(app|marketplace_builder)/lib/` matches `Partial` first.

Key exported functions:
- `getFileType(uri)` — returns `PlatformOSFileType | undefined`
- `getAppPaths(type)` — returns `app/`-prefixed search paths for a file type
- `getModulePaths(type, moduleName)` — returns all `{app/,}modules/{name}/{public,private}/` search paths
- `isKnownLiquidFile`, `isKnownGraphQLFile`, `isPartial`, `isPage`, `isLayout`, etc. — convenience predicates

When adding a new file type or directory alias, update only `FILE_TYPE_DIRS`. The regex matchers, `getAppPaths`, and `getModulePaths` all derive from it automatically.

### `DocumentsLocator` (`documents-locator/DocumentsLocator.ts`)

Resolves a document reference (from Liquid tags like `render`, `function`, `include`, `graphql`, `asset`) to a concrete filesystem URI, and lists matching completions.

- `locate(rootUri, nodeType, fileName)` — tries all candidate search paths in order, returns the first URI that `stat()`s as a file. Handles the `modules/{name}/...` prefix convention by routing to module paths instead of app paths.
- `list(rootUri, nodeType, filePrefix)` — walks all candidate directories and returns sorted, de-duplicated relative names matching the prefix.

File suffixes are added automatically: `.liquid` for partials, `.graphql` for graphql. Assets have no extension filtering.

### `TranslationProvider` (`translation-provider/TranslationProvider.ts`)

Loads and searches platformOS YAML translation files.

Two file layouts are supported for each locale and translation base directory:
- **Single file**: `{base}/{locale}.yml`
- **Split files**: `{base}/{locale}/*.yml`

Both are checked in every method. `loadAllTranslationsForBase` deep-merges all files for a locale and accepts an optional `contentOverride` callback (used by editor integrations to honour unsaved buffer content). `findTranslationFile` returns the URI + stripped key for a given translation key. `translate` resolves a key to its string value.

Module translation keys use the prefix `modules/{name}/...`; these are routed to the module translation directories (`app/modules/{name}/public/translations`, etc.).

## Key Invariants

- **URIs, not filesystem paths**: all public APIs use `UriString` (a `vscode-uri`-compatible `file://...` string), never raw OS paths.
- **Do not add environment-specific imports** (`fs`, `path`, etc.) — this package must remain browser-safe.
- `FILE_TYPE_DIRS` drives both classification and search path generation. Keep it in sync with the server's `converters_config.rb`.
