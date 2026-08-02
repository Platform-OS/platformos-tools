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

### `app/` — The lazy `App` object model

`App` / `AppFile` are the single answer to "the project's files, parsed". The toolchain
previously had four: check-node's `getApp`, the language server's `DocumentManager`,
the graph's `toSourceCode`, and a fingerprint cache.

All four are now this one. `DocumentManager` holds an `App` per project root and adds
only what is LSP-specific (versions, rename tracking, `textDocument`); the graph reads
through `appBackedGetSourceCode(app, fallback)` so a graph build and a check run in one
process hold the SAME `AppFile`s. **A parsed-source cache keyed on `(uri, fingerprint)`
is not the way to share parses here — sharing the file OBJECTS is.** The graph's
`toSourceCode` survives as the path for a caller holding a buffer and no app (an
in-flight `validate_code` buffer, a URI outside the project), which by definition has
no `AppFile`.

- **`App.fromPaths(rootUri, uris, fs, parsers)` classifies paths and does NO I/O.** No
  `stat`, no read, no parse. That is what makes it affordable per call rather than once
  per process, and what removed 15 s and ~750 MB of transient AST garbage from every
  `validate_code` call.
- **`load()` is async, `ast` is a SYNC memoized getter.** Checks read `file.ast` inline
  (`visitLiquid(file.ast, check)`), so an async parse would touch every check. A
  consumer awaits `load()` for the files it will touch, then reads `ast` synchronously.
  Same split as Ruby's `source` / `parse`.
- **`source` THROWS when unloaded.** A silent `''` would turn "nobody awaited `load()`"
  into wrong lint results, which is much harder to find than a stack trace.
  `loadedSource` is the non-throwing read for "prefer an in-memory buffer over disk".
- **Parsers are injected** (`Parsers`, keyed by `SourceCodeType` plus an `extensions`
  map). This package sits below `liquid-html-parser` / `jsonc-parser` / `yaml`, so it
  cannot parse anything itself — which is exactly what lets check-node, the language
  server and the graph share ONE set of file objects. `platformos-graph` registers its
  `.js`/image parsers this way rather than building a second set.
- **`find(type, name)` is O(1)** over a per-type `Map<name, AppFile[]>`, and its
  precedence is `AppPathInfo.searchPathIndex` — the file's position in the very
  candidate list `getAppPaths`/`getModulePaths` produce. So it cannot disagree with
  `DocumentsLocator`'s "first candidate that stats as a file wins"; it is a
  precomputation of it. `app/modules/X/…` shadowing `modules/X/…` falls out of the same
  ordering.
- **`AppFile#name`** is the logical name a `render`/`function`/`graphql`/`asset`
  reference spells: the path with its type's directory prefix stripped and its
  extension removed, `modules/<name>/`-prefixed for module files. Assets keep their
  extension. All derived from `FILE_TYPE_DIRS`.
- **There is no JSON source type.** JSON responses come from `.json.liquid`; the only
  `.json` files the platform deploys are the two fixed asset manifests. A stray `.json`
  gets no `SourceCodeType` and nothing parses it. Ruby's `App::REGEXP_MAP` agrees.
- `SourceCodeType` lives here (re-exported by check-common, never duplicated — two
  enums with equal values are nominally distinct in TypeScript).

`update(uris)` re-classifies only the named files; every other file keeps the source it
read and the AST it parsed. `remove(uris)` promotes a shadowed module original back
into the name index. `setSource(uri, source, version)` is the editor-buffer role and
adds files that do not exist on disk yet.

### `app/walk.ts` — the one project walk over an `AbstractFileSystem`

`walkAppSourceFiles(fs, rootUri, filter?)` returns every file under
`APP_SOURCE_SUBTREES`. Used by the graph build and the language server's preload;
check-node globs the same subtrees with its own Node-only walk.

**Anchored, never blacklisted.** Do not "simplify" this back into a walk from the root
that skips directories by NAME. That is a different question and it is wrong both
ways: `app/views/pages/vendor/**` is a live site section that any `vendor` blacklist
drops (137 files on one real project), and `tmp/app/views/partials/x.liquid` is not a
partial no matter what it is called. Anchoring is also the fastest of the three
options, because the walk never opens those directories at all — 6 ms against 19-23
(old blacklist) and 63-69 (blacklist shortened to the safe names) on a tree with 20 000
files under root-level `dist`/`build`/`vendor`.

A subtree that does not exist is discovered by listing its PARENT, not by probing:
every `AbstractFileSystem` implementation reports a missing directory differently, and
most projects have no `marketplace_builder/` and no `modules/`. A directory that IS
listed and then fails to read still throws.

### `path-utils.ts` — File type classification

`FILE_TYPE_DIRS` is the **single source of truth** for all platformOS directory names, mapping each `PlatformOSFileType` enum value to its canonical directory names (including legacy aliases from the server's `converters_config.rb`).

`TYPE_MATCHERS` pre-compiles one regex per type from `FILE_TYPE_DIRS`, matching both app-level paths (`/(app|marketplace_builder)/{dir}/`) and module paths (`/(public|private)/{dir}/`). This design prevents false positives — e.g. `app/lib/smses/file.liquid` resolves to `Partial`, not `Sms`, because `/(app|marketplace_builder)/lib/` matches `Partial` first.

Key exported functions:
- `getFileType(uri)` — returns `PlatformOSFileType | undefined`
- `getAppPaths(type)` — returns `app/`-prefixed search paths for a file type
- `getModulePaths(type, moduleName)` — returns all `{app/,}modules/{name}/{public,private}/` search paths
- `isKnownLiquidFile`, `isKnownGraphQLFile`, `isPartial`, `isPage`, `isLayout`, etc. — convenience predicates

`parseAppPath(relativePath)` is the anchored counterpart to `getFileType`: it resolves
a root-relative path into its type, the directory of that type it matched, its module
and access level, whether it is an `app/modules/…` overwrite, and its
`searchPathIndex`. `AppFile` classifies with it and ONLY with it — matching a known
directory anywhere in a path, which is all `getFileType` can do, is not enough
(`seed/post_import/app/migrations/x.liquid` is not a migration).

**A known directory is not enough; the extension is part of the type.** Every backend
model but `Page`, `InstanceView` (Layout/Partial) and `Asset` anchors its extension in
`PHYSICAL_PATH`, so `app/graphql/x.yml` and `app/translations/en.json` are not
classified at all. `REFERENCE_EXTENSIONS` is where that per-type extension lives — it
drives classification, `nameToPaths`, `pathToName` and `SOURCE_FILE_EXTENSIONS` from
one table — and `EXTENSION_AGNOSTIC_TYPES` is the three-and-a-bit exceptions. **`.yaml`
is not a platformOS extension**; every YAML model anchors `\.yml\z`.

**Two whitelists, no ignore list.** Classification answers "does the platform deploy
this"; `sourceCodeTypeOf` (`app/types.ts`) answers "do we have a parser for this".
`isSupportedSourceFile` is their intersection and contains nothing else:

```ts
getFileType(uri) !== undefined && sourceCodeTypeOf(uri) !== undefined
```

Neither implies the other — `app/views/pages/home.html` is a deployed Page we cannot
read, a `.liquid` file in `scripts/` is readable and not deployed.

Do not add an exclusion list to either. There was one — a `/\.(s?css|js)\.liquid$/`
test inside `isSupportedSourceFile` — and because an ignore-list is only consulted by
whoever remembers it, the language server refused `theme.css.liquid` while the lint,
which goes through `App.fromPaths` and `sourceCodeTypeOf`, put it in the app with the
Liquid+HTML parser and reported `LiquidHTMLSyntaxError` on it. A file we cannot parse
is now one with no row in `SOURCE_CODE_TYPE_BY_KEY`, and absence cannot be forgotten.

The key is the response format for `.liquid` files, because the format IS the body
language: `users.json.liquid` is parsed, `theme.css.liquid` is not, and the platform's
FORMAT_ENUM (`custom_view.rb:9`) decides which dotted segments are formats at all —
`modal.frame.liquid` is a partial named `modal.frame`, not a `frame`-format file.

When adding a new file type or directory alias, update `FILE_TYPE_DIRS` and
`REFERENCE_EXTENSIONS`. The regex matchers, `parseAppPath`, `getAppPaths`,
`getModulePaths`, `SOURCE_FILE_GLOB` and every walker downstream derive from those two.

This package owns **three** facts about a file, not just the directory one:

| Fact | Source of truth | Enforced by |
|---|---|---|
| Which DIRECTORIES hold which type | `FILE_TYPE_DIRS` | `app/directory-knowledge.spec.ts`, first describe |
| Which EXTENSION each type has | `REFERENCE_EXTENSIONS` (+ `EXTENSION_AGNOSTIC_TYPES`), read via `getReferenceExtensions` | `path-utils.spec.ts` |
| Which EXTENSIONS are sources | `SOURCE_FILE_EXTENSIONS`, and `SOURCE_FILE_GLOB` for walkers/watchers | same file, second describe |
| Which parser each one gets | `sourceCodeTypeOf` (`app/types.ts`) | — |

Both guards scan every workspace package's `src/` and fail on a second copy. The
extension rule fires on a **list** (two or more distinct source extensions in one
file) — a single `.liquid` is legitimate, a list is always someone re-deriving what a
platformOS source is. Consumers: the lint's project glob, the language server's
file-operation filter and file watcher, and `toSourceCode`.

### `DocumentsLocator` (`documents-locator/DocumentsLocator.ts`)

Resolves a document reference (from Liquid tags like `render`, `function`, `include`, `graphql`, `asset`) to a concrete filesystem URI, and lists matching completions.

- `locate(rootUri, nodeType, fileName)` — with an `App` (second constructor argument),
  an O(1) index lookup with no I/O; otherwise tries all candidate search paths in
  order and returns the first URI that `stat()`s as a file. Handles the
  `modules/{name}/...` prefix convention by routing to module paths instead of app
  paths. The walk stays reachable for callers with no `App`, and for assets — the
  lint's glob collects only Liquid, GraphQL and YAML, so an asset is never in the
  index. The two cannot disagree about which file wins (see `searchPathIndex` above);
  the one intentional difference is that a file existing only as an unsaved buffer is
  found by the index and not by the walk.
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
- **Do not add environment-specific imports** (`fs`, `path`, etc.) — this package must remain browser-safe. Enforced by `src/app/package-boundaries.spec.ts`, which also pins the dependency list, because the `App` model only stays shareable while this package sits below the parsers.
- **Every workspace package must declare the `@platformos/*` siblings it imports**, enforced by `src/app/workspace-dependencies.spec.ts`. Yarn hoisting hid six missing declarations until it was added.
- `FILE_TYPE_DIRS` drives both classification and search path generation. Keep it in sync with the server's `converters_config.rb`.
