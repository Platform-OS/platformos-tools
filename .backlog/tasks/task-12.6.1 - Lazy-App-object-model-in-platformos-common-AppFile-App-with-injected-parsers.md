---
id: TASK-12.6.1
title: Lazy App object model in platformos-common (AppFile/App with injected parsers)
status: Done
assignee: []
created_date: '2026-07-31 16:41'
updated_date: '2026-07-31 18:10'
labels:
  - performance
  - platformos-common
  - architecture
dependencies: []
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The core of TASK-12.6's chosen approach: reproduce the Ruby `platformos-check` App model as the single source of truth for what an app file is, where it lives, and when its parse is stale. Reference: `~/projects/lsp/platformos-check/lib/platformos_check/{app,app_file,liquid_file,yaml_file,storage}.rb`.

Nothing else in this epic can land first — 12.6.3–12.6.6 all migrate onto this. Ships with NO consumer changes, so it cannot regress anything on its own.

## Where it goes

`packages/platformos-common/src/app/`. It builds on the classification source of truth this package already owns (`FILE_TYPE_DIRS` → `TYPE_MATCHERS`, `getFileType`, `getAppPaths`/`getModulePaths`, `AbstractFileSystem`). Do NOT re-derive directory knowledge — everything must come from `FILE_TYPE_DIRS`.

## Shape

- `AppFile` (abstract): constructed from `(uri, fs)` only — construction does NO I/O, which is what makes `App.fromPaths` cheap.
  - `uri`, `relativePath`, `type: PlatformOSFileType`
  - `name` — the LOGICAL name a `render`/`function`/`include` uses, i.e. the path with its type's directory prefix stripped, plus a `modules/<name>/` prefix for module files. This is Ruby's `AppFile#name` / `#build_name` / `#dir_prefix`, and it is what the per-type index is keyed on.
  - `moduleName`, `isModuleOriginal`, `isModuleOverwrite`, `moduleOriginalUri`, `moduleOverwriteUri` — Ruby's shadowing model.
  - `load(): Promise<void>` — reads source via `fs`, memoized.
  - `source: string` — sync, throws (or returns `''`) if not loaded; see the sync/async split below.
  - `setSource(source, version?)` — the editor-buffer / `InMemoryStorage` role. Bumps version, drops the cached parse.
  - `invalidate()` — drop source and parse.
- Subclasses per type: `LiquidFile` (adds the `ast` getter), `YamlFile` (adds `content` + captured parse error, cf. Ruby `yaml_file.rb`), `GraphqlFile`, `AssetFile`, plus the thin `PartialFile`/`PageFile`/`LayoutFile` markers that carry `dirPrefix`.
- `App`:
  - `App.fromPaths(rootUri, uris, fs, parsers)` — classifies PATHS ONLY. No reads, no parses.
  - `byUri: Map<UriString, AppFile>` and a per-type `Map<name, AppFile>` (Ruby's `grouped_files`).
  - `partials()`, `pages()`, `layouts()`, `translations()`, `all()`, `get(uri)`, `find(type, name)`.
  - `update(uris)` / `remove(uris)` — incremental re-classify and re-index (Ruby `App#process_files`), including the module-shadowing restore: removing an `app/modules/X` overwrite must bring the `modules/X` original back into the index, and vice versa.

## The two constraints that shape the API

1. **`ast` must stay SYNC.** Checks read `file.ast` synchronously (`visitLiquid(file.ast, check)`, `onCodePathEnd(file & { ast })`). Making it async would touch every check in the codebase. So: `load()` is async and reads the source; `ast` is a sync memoized getter over the already-in-memory source. A consumer awaits `load()` for the files it will actually touch, then reads `ast` synchronously. This is exactly Ruby's `source` (lazy read) / `parse` (memoized) split.

2. **Parsers are INJECTED.** `platformos-common` sits below the parser stack — its only deps are `js-yaml`, `vscode-json-languageservice`, `vscode-uri`, while `liquid-html-parser`, `jsonc/parse` and `yaml/parse` live in check-common above it. `App` therefore takes a `Parsers` map keyed by `SourceCodeType`, the same way it already injects `AbstractFileSystem`. This keeps the package browser-safe and is what lets `platformos-graph` register its own JS/asset parser (12.6.5) instead of forking `toSourceCode`.

## Structural compatibility

`AppFile` must satisfy the existing `SourceCode<T>` structural shape (`uri`, `type`, `source`, `ast`, `version?`) via getters, so `check()` and every existing check keep compiling once consumers migrate. Parse failures stay CAPTURED as `Error` values in `ast` — never thrown — matching today's `toSourceCode` behaviour and TASK-12.6 AC #6.

## Not in scope

No consumer migration. `getApp`, `DocumentManager`, the graph and `AppCache` are untouched by this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AppFile construction performs no I/O — a test builds an App from several thousand paths with a fs whose readFile throws, and it succeeds
- [ ] #2 load() reads source at most once per file per version, and ast parses at most once — pinned with a counting fs and a spied parser
- [ ] #3 ast is readable synchronously after load() resolves, and no check-visible signature needs to become async
- [ ] #4 A parse error is captured as an Error value on ast rather than thrown, for each of the liquid, yaml, json and graphql types
- [ ] #5 name resolves the logical render name for app-level, app/lib, and modules/<name>/{public,private} partials, derived from FILE_TYPE_DIRS with no new hardcoded directory list
- [ ] #6 find(type, name) resolves in O(1) and an app/modules/X file shadows its modules/X original
- [ ] #7 remove() of a module overwrite restores the shadowed original to the index, and remove() of an original when an overwrite exists keeps the overwrite
- [ ] #8 update() re-indexes only the named uris — a test pins that untouched files keep their already-parsed ast instance
- [ ] #9 setSource() bumps version and drops the cached parse, so the next ast read reflects the new source
- [ ] #10 Parsers are injected — the package declares no dependency on liquid-html-parser and stays importable in a browser-target build
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented in `packages/platformos-common/src/app/`

`AppFile.ts` (base + `LiquidFile`/`PartialFile`/`PageFile`/`LayoutFile`/`YamlFile`/
`TranslationFile`/`GraphqlFile`/`AssetFile`, plus `createAppFile`), `App.ts`,
`types.ts` (`SourceCodeType`, `Parser`, `Parsers`), `uri.ts`. Specs: `App.spec.ts`
(42), `package-boundaries.spec.ts`, `workspace-dependencies.spec.ts`.

### Decisions taken where the task description was ambiguous

- **`type` is the `SourceCodeType`, not the `PlatformOSFileType`.** The description
  asked for both `type: PlatformOSFileType` AND structural `SourceCode`
  compatibility, which conflict — `type` is the discriminant every check and
  `filesOfType` narrows on. So `AppFile.type: SourceCodeType | undefined` and
  `AppFile.fileType: PlatformOSFileType`.
- **`SourceCodeType` MOVED to platformos-common** and is re-exported from
  check-common, rather than duplicated. Two enums with equal values are nominally
  distinct in TS, so duplication would have broken every consumer.
- **`source` throws when unloaded** rather than returning `''`. A silent empty
  string turns "nobody awaited load()" into wrong lint results (empty translation
  tables, partials with no `{% doc %}`), which is far harder to find than a stack
  trace naming the file. `loadedSource` is the non-throwing read for
  "prefer an in-memory buffer over disk".
- **No JSON.** `.json` is deliberately absent from the extension→`SourceCodeType`
  map: JSON responses come from `.json.liquid`, the only `.json` files the platform
  deploys are the two fixed asset manifests (`assets.json`, `asset_manifest.json`),
  and Ruby's `App::REGEXP_MAP` has no JSON entry (`JsonFile` is a dead class). A
  stray `.json` is an asset — no source-code type, nothing parses it.
- **Name derivation is uniform across types**, not just Partial/Layout/GraphQL/Asset
  as in Ruby. Assets keep their extension (that is how `{% asset %}` spells them);
  everything else drops the last one.
- **`all()` returns every file, including a shadowed module original.** Ruby's
  `grouped_files` holds only index winners, which would silently stop linting a
  shadowed original. Shadowing applies to `find()` only.

### Precedence: proven equal to the walk, not asserted

`parseAppPath` (new, in `path-utils.ts`, derived from `FILE_TYPE_DIRS`) computes a
`searchPathIndex` = the file's position in the `getAppPaths`/`getModulePaths`
candidate list. The name index sorts candidates by it, so `find()` returns exactly
what "first candidate that stats as a file wins" returns. `path-utils.spec.ts` pins
this by computing the walk index independently and comparing, over app-level,
module-original, module-overwrite, public/private and multi-dir cases.

`marketplace_builder/` files get `searchPathIndex: undefined` and rank last —
correct, because `getAppPaths` never searches there, so the walk never finds them
either.

### Classification keeps today's file set exactly

`createAppFile` classifies with anchored `parseAppPath` and FALLS BACK to
`getFileType` ("known directory anywhere in the URI"), because the glob that feeds
`getApp` uses the latter. Without the fallback, a file under e.g.
`vendor/app/views/partials/` would have silently stopped being linted.

### Acceptance criteria

- #1 ✔ 5000 paths classified against an `fs` whose every method throws.
- #2 ✔ counting fs + spied parser: one read per file per version, one parse.
- #3 ✔ `ast` is a sync getter; no check signature changed.
- #4 ✔ pinned for liquid, yaml and graphql. JSON is not a platformOS source type
  (see above), so there is no JSON case to pin; a parser that THROWS is also
  captured, and a missing parser yields an `Error` value too.
- #5 ✔ app-level, `app/lib`, and both module roots, derived from `FILE_TYPE_DIRS`
  with no new directory list.
- #6 ✔ O(1) via `Map<name, AppFile[]>`; overwrite shadows original in both
  classification orders.
- #7 ✔ removing an overwrite promotes the original; removing the original keeps the
  overwrite. Implemented by keeping ALL candidates per name rather than Ruby's
  "recompute the counterpart", which also covers same-name-different-dir pairs.
- #8 ✔ untouched files keep their already-parsed `ast` INSTANCE (identity-compared).
- #9 ✔ `setSource` bumps version, drops the parse; also pinned that it wins over a
  read already in flight.
- #10 ✔ `package-boundaries.spec.ts` asserts the dependency list is exactly
  `js-yaml`, `vscode-json-languageservice`, `vscode-uri`, and that no source file
  imports anything from Node.
<!-- SECTION:NOTES:END -->
