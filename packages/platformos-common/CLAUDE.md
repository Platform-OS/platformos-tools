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

**An app is handed over for BOTH seams or neither.** `IDependencies.app` is the
resolution half of the same object: with it, a `{% render %}`/`{% function %}`/`layout:`
target is answered by `findOrLocate`'s index; without it, `DocumentsLocator` builds a
walk-only stand-in and every reference in the project costs a `readDirectory` per
candidate directory (6993 → 590 listings on a real 3450-file project; the answers are
identical either way, since the index only short-circuits the same walk). A caller good
enough to read a file through is good enough to find it with.

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
- **`load()` stats before it reads, and `loadedStat` is that stat.** It is the freshness
  baseline for a cache that outlives the call which filled it (check-node's shared `App`),
  and the ORDER is a correctness property: observed before the read, the worst case is a
  baseline describing an OLDER state than the content, which fails the next comparison and
  re-reads; observed after, it could describe a write that landed during the read, and
  pairing that with the older content in hand is how a cache comes to serve stale source.
  `undefined` means "no baseline" — a buffer set by `setSource`, or a filesystem that cannot
  `stat` — never "unchanged". This package records the observation and never interprets it;
  check-node's `fingerprintOf`/`fingerprintOfStat` pair is the one place two of them are
  compared, so the formatting cannot drift into two spellings that never match.
- **Parsers are injected** (`Parsers`, keyed by `SourceCodeType` plus an `extensions`
  map). This package sits below `liquid-html-parser` / `jsonc-parser` / `yaml`, so it
  cannot parse anything itself — which is exactly what lets check-node, the language
  server and the graph share ONE set of file objects. `platformos-graph` registers its
  `.js`/image parsers this way rather than building a second set.
- **`find(type, name)` is O(1)** over a per-type `Map<name, AppFile[]>`, and its
  precedence is `AppPathInfo.searchPathIndex` — the file's position in the very
  candidate list `getAppPaths`/`getModulePaths` produce — with `formatRank` as the
  tiebreak within one directory (`card.liquid` before `card.json.liquid`, in
  `nameToPaths`' suffix order). `app/modules/X/…` shadowing `modules/X/…` falls out
  of the same ordering.
- **`findOrLocate(type, name)` is THE resolver** — the one answer to "which file
  does this name mean", for every caller. Index first; on a miss, the filesystem:
  one `readDirectory` per candidate directory (candidates and precedence from
  `nameToPaths`), matching entry names rather than `stat`ing spellings, which is
  what lets it cover every response format (`index.csv.liquid` under `index`) at
  the I/O cost of covering one. The miss path exists because an index is only as
  complete as the walk that fed it: check-node's collects no assets, a file may
  appear after the walk, and an unpreloaded app is empty.
  Assets NEVER use the index (see `findOrLocate`'s doc for why staleness decides
  that). Async sibling of `find`, deliberately — `find` is called from sync check
  code and must stay free of I/O.
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

### `os-path.ts` — the one filesystem-path spelling, for the whole monorepo

The counterpart to `app/uri.ts`: that file owns how a **URI** is spelled, this one owns
how a **filesystem path** is, and the one function that crosses between them lives here.

- `toPosixPath(fsPath)` — forward slashes, collapsed separators, no trailing one. The
  same normalization as `normalize-path` (pos-cli's), ported so the browser-safe package
  every other one depends on can own it; `check-node` dropped that dependency. It
  **throws** for a URI, because collapsing `file:///c:/x` to `file:/c:/x` produces a
  plausible URI for a different location.
- `relativePosixPath(fsPath, baseDir)` — the path spelling a guard, a message or a
  matcher compares on. Prefix matching is at a segment boundary, and a path outside
  `baseDir` comes back whole, exactly like `relativeUriPath`.
- `uriFromPath(fsPath)` / `uriFromPathOrUri(pathOrUri)` — THE path → URI conversion.
  `URI.file(p).toString()` is not it: that percent-encodes the drive colon
  (`file:///c%3A/…`), so it compares unequal to every URI a walk, a config or an `App`
  produced, and only on Windows. `uriFromPathOrUri` adds the scheme sniff for a caller
  that cannot tell which it was handed (a CLI argument, an `ignore` subject) — a
  one-letter "scheme" is a drive, not a scheme.

`os-path.spec.ts` scans every package's `src/` — **specs included** — and fails on a
second implementation of any of this: a hand-rolled `\`→`/` replace, or an import of
`normalize-path`. Four modules are exempt because they own a spelling: this one, its
spec, `app/uri.ts`, and check-common's `path.ts` (`childUri` appends one directory-entry
name and has to treat that fragment the way `normalizeUri` would).

### `path-utils.ts` — File type classification

`FILE_TYPE_DIRS` is the **single source of truth** for all platformOS directory names, mapping each `PlatformOSFileType` enum value to its canonical directory names (including legacy aliases from the server's `converters_config.rb`).

`PATH_PATTERNS` pre-compiles one anchored regex per (type, dir) pair from
`FILE_TYPE_DIRS`, covering app-level paths (`{app,marketplace_builder}/{dir}/`) and
module paths (`[app/]modules/{name}/{public,private}/{dir}/`), in `FILE_TYPE_DIRS`
order so the first match wins. That ordering is what prevents false positives —
`app/lib/smses/file.liquid` resolves to `Partial`, not `Sms`, because `app/lib/`
matches first. There is ONE such table: an unanchored second one (`TYPE_MATCHERS`)
existed alongside it and was deleted, because two path grammars that must stay in
step are two answers to the same question.

Key exported functions:
- `getFileType(uri, rootUri)` — returns `PlatformOSFileType | undefined`
- `getAppPaths(type)` — returns `app/`-prefixed search paths for a file type
- `getModulePaths(type, moduleName)` — returns all `{app/,}modules/{name}/{public,private}/` search paths
- `isPartial`, `isPage`, `isSupportedSourceFile` — convenience predicates. Only these
  three; the per-type `isLayout`/`isSms`/`isKnownLiquidFile`/… family was deleted once
  every caller had moved to `context.fileType` or `AppFile.fileType`. A new one-type
  question is `getFileType(uri, root) === PlatformOSFileType.X`, and a caller holding
  an `AppFile` reads `file.fileType`, which was derived once at construction.

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

**Three questions, no ignore list.** Classification answers "does the platform deploy
this"; `isParsedFileType` answers "is this a type whose contents we read at all";
`sourceCodeTypeOf` (`app/types.ts`) answers "do we have a parser for this spelling".
`isSupportedSourceFile` is their intersection and contains nothing else:

```ts
const type = getFileType(uri, rootUri);
type !== undefined && isParsedFileType(type) && sourceCodeTypeOf(uri) !== undefined
```

None implies another — `app/views/pages/home.html` is a deployed Page we cannot read, a
`.liquid` file in `scripts/` is readable and not deployed, and `app/assets/x.liquid` is
deployed AND readable and still not a source.

**An asset is served, never rendered** (`isParsedFileType`), and that is a TYPE fact no
extension can carry. A bare `.liquid` has no response format, so its key falls back to
`html.liquid` — which has a parser row — and `app/assets/x.liquid` was read as Liquid and
linted like a page: measured, a broken one produced `LiquidHTMLSyntaxError` and, through
the MCP supervisor, a `must_fix_before_write: true`. A false block on a file the platform
hands back byte-for-byte, while `theme.css.liquid` — the asset form the platform genuinely
DOES process — was exempt because `css` is a format with no row. `App.findOrLocate` had
already stated the rule ("Nothing reads an asset, so the only question about one is whether
it exists"); `isParsedFileType` is that sentence made enforceable.

It is an explicit exclusion of one type rather than a whitelist of the other eighteen, and
the direction matters: a NEW `PlatformOSFileType` defaults to READ, so a type added without
a check fails the supervisor's file-type-coverage group (in
`platformos-mcp-supervisor/src/transport/validate-code.spec.ts`) loudly instead of
silently never being linted.
Applied in exactly two places — here and `AppFile`'s constructor — so no consumer holds a
private opinion about it.

Do not add an exclusion list to any of the three. There was one — a
`/\.(s?css|js)\.liquid$/` test inside `isSupportedSourceFile` — and because an ignore-list
is only consulted by whoever remembers it, the language server refused `theme.css.liquid`
while the lint, which goes through `App.fromPaths` and `sourceCodeTypeOf`, put it in the
app with the Liquid+HTML parser and reported `LiquidHTMLSyntaxError` on it. A file we
cannot parse is now one with no row in `SOURCE_CODE_TYPE_BY_KEY`, and absence cannot be
forgotten. `isParsedFileType` is not such a list and the difference is exactly that one:
it is a shared, exported rule that both deciders consult, not a private test inside one of
them.

The key is the response format for `.liquid` files, because the format IS the body
language: `users.json.liquid` is parsed, `theme.css.liquid` is not, and the platform's
FORMAT_ENUM (`custom_view.rb:9`) decides which dotted segments are formats at all —
`modal.frame.liquid` is a partial named `modal.frame`, not a `frame`-format file.

When adding a new file type or directory alias, update `FILE_TYPE_DIRS` and
`REFERENCE_EXTENSIONS`. The regex matchers, `parseAppPath`, `getAppPaths`,
`getModulePaths`, `SOURCE_FILE_GLOB` and every walker downstream derive from those two.

This package owns **five** facts about a file, not just the directory one:

| Fact | Source of truth | Enforced by |
|---|---|---|
| Which DIRECTORIES hold which type | `FILE_TYPE_DIRS` | `guards/directory-knowledge.spec.ts`, first describe |
| Which EXTENSION each type has | `REFERENCE_EXTENSIONS` (+ `EXTENSION_AGNOSTIC_TYPES`), read via `getReferenceExtensions` | `path-utils.spec.ts` |
| Which EXTENSIONS are sources | `SOURCE_FILE_EXTENSIONS`, and `SOURCE_FILE_GLOB` for walkers/watchers | same file, second describe |
| Whether a type's contents are READ at all | `isParsedFileType` (Asset is not) | `path-utils.spec.ts`, `app/App.spec.ts` |
| Which parser each one gets | `sourceCodeTypeOf` (`app/types.ts`) | — |

Both guards scan every workspace package's `src/` and fail on a second copy. The
extension rule fires on a **list** (two or more distinct source extensions in one
file) — a single `.liquid` is legitimate, a list is always someone re-deriving what a
platformOS source is. Consumers: the lint's project glob, the language server's
file-operation filter and file watcher, and `toSourceCode`.

`APP_WATCH_GLOBS` is the same knowledge in the shape a FILE WATCHER needs it: all three
tables crossed into `parseAppPath`'s grammar as globs, anchored on the exact directories
an app file can be in. Do not respell it in a consumer. The language server used to
watch `**/*.liquid` and friends, which delivers every generator template, build
artifact, seed and `node_modules` copy in the repository — and each event was read
before the server found out it was not an app file. Two rules hold it together:

- **Every brace group holds ONE path segment.** The LSP glob syntax promises `*`, `?`,
  `**`, `[]` and `{}` and says nothing about a `{}` whose alternatives contain `/`, so
  `app/modules` is a literal prefix rather than an alternative next to `modules`, and
  the type directories are grouped by parent (`views/{pages,layouts,partials}`).
- **Assets are absent.** Nothing reads an asset, so the only question about one is
  whether it exists, and `DocumentsLocator` answers that with a `stat` rather than from
  the index — see below. Watching them would deliver an event per image and buy nothing.

### `DocumentsLocator` (`documents-locator/DocumentsLocator.ts`)

Resolves a document reference (from Liquid tags like `render`, `function`, `include`, `graphql`, `asset`) to a concrete filesystem URI, and lists matching completions.

Resolution itself is NOT this class's — `App.findOrLocate` owns it (see above), in
one place for every caller. `DocumentsLocator` maps the reference kind to a
`PlatformOSFileType`, the root to an `App` (the one supplied at construction — an
`App` or, for a caller serving several roots, an `AppResolver` function — or a
walk-only stand-in built on the fly when none was), and adds the theme-search-path
machinery (`locateWithSearchPaths`, dynamic `{{ … }}` expansion) and creation-path
answers (`locateDefault`) on top.

- `locate(rootUri, nodeType, fileName)` — `App.findOrLocate` for the mapped type:
  index first, filesystem for a name the index cannot answer, assets always from
  the filesystem. Handles the `modules/{name}/...` prefix convention via
  `nameToPaths`.
- `list(rootUri, nodeType, filePrefix)` — walks all candidate directories and returns sorted, de-duplicated relative names matching the prefix.

File suffixes are added automatically: `.liquid` for partials, `.graphql` for graphql. Assets have no extension filtering.

### `graphql/` — how a platformOS GraphQL document is read

`parseGraphql(content)` is THE GraphQL parse for the toolchain, and the two extractors
beside it are what platformOS means by a GraphQL document: `extractGraphqlTables` (the
model tables an operation targets, the join partner of `extractSchemaTable`'s `name:`)
and `extractGraphqlVariables` (what a `{% graphql %}` call site may and must pass).

- **The result is a value, never a throw.** `GraphQLDocumentNode` is
  `{ type, content, document?, syntaxError? }` — a document that does not compile is a
  normal state that `GraphQLCheck` reports on, so the syntax error travels inside the
  node rather than as the `Error` a `Parser` may return, which would take the file out
  of the pipeline that reports it.
- **The extractors take the parsed node, not a string**, because the point is that
  nobody parses twice. `check-common` injects `parseGraphql` as the `App`'s GraphQL
  parser, so a `.graphql` file is parsed once until its source changes and the lint, the
  language server and the graph all read that one document. There is deliberately no
  cache in here: the `AppFile` is the cache.
- The one caller with no file is an inline `{% graphql res %}…{% endgraphql %}` body,
  which calls `parseGraphql` directly on the text between the tags.

Enforced by `platformos-check-common/src/index.spec.ts` (a document is
parsed once per run, and again after `setSource`) and by `identity-ownership.spec.ts`
(no check package re-exports these).

### `TranslationProvider` (`translation-provider/TranslationProvider.ts`)

Loads and searches platformOS YAML translation files.

Two file layouts are supported for each locale and translation base directory:
- **Single file**: `{base}/{locale}.yml`
- **Split files**: `{base}/{locale}/*.yml`

Both are checked in every method. `loadAllTranslationsForBase` deep-merges all files for a locale and accepts an optional `contentOverride` callback (used by editor integrations to honour unsaved buffer content). `findTranslationFile` returns the URI + stripped key for a given translation key. `translate` resolves a key to its string value.

Module translation keys use the prefix `modules/{name}/...`; these are routed to the module translation directories (`app/modules/{name}/public/translations`, etc.).

## Key Invariants

- **URIs, not filesystem paths**: all public APIs use `UriString` (a `vscode-uri`-compatible `file://...` string), never raw OS paths. A caller holding an OS path crosses over with `uriFromPath` — the only sanctioned conversion, and the reason `os-path.ts` is the one place that knows both spellings.
- **Do not add environment-specific imports** (`fs`, `path`, etc.) — this package must remain browser-safe. Enforced by `src/guards/package-boundaries.spec.ts`, which also pins the dependency list, because the `App` model only stays shareable while this package sits below the WORKSPACE packages that own the ASTs. "Below the parser stack" is about those and about browser safety, not about never reading a format: a platformOS fact defined in YAML (`extractSchemaTable`) or in GraphQL (`graphql/`) is read here, with `js-yaml` and `graphql`, and `App` still takes every parser by injection.
- **Every workspace package must declare the `@platformos/*` siblings it imports**, enforced by `src/guards/workspace-dependencies.spec.ts`. Yarn hoisting hid six missing declarations until it was added.
- `FILE_TYPE_DIRS` drives both classification and search path generation. Keep it in sync with the server's `converters_config.rb`.
