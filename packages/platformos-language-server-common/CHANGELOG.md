# @platformos/theme-language-server-common

## 0.1.0

### Minor Changes

- cf80cfa: `check()` takes an `App`, so the language server gets the name index too.

  `check-common` declared `App = AppModel | SourceCode[]` and reduced it with
  `app: Array.isArray(app) ? undefined : app`. The language server passed
  `documentManager.app(rootUri, …)` — an array — so in the editor `dependencies.app`
  was ALWAYS `undefined`: every `DocumentsLocator` inside every check fell back to
  `stat`-ing candidate paths in order (4 per partial, 16 per module partial), and
  `context.fileType` re-derived through `getFileType` what the file had already
  classified once. The editor is where that latency is visible to a person, and it was
  the one consumer not getting the model the rest of the toolchain was moved onto.

  The union is gone. `check()` and `autofix()` take an `AppModel`; `runChecks` passes
  `documentManager.appModel(rootUri)` and narrows what is VISITED with
  `{ only: <the documents it publishes for> }`, so the set of files that get diagnostics
  is unchanged while the checks can now see the whole project.

  Measured on three real projects, checking every file the editor can be asked for,
  before and after in the same session: 190.1 s → 100.2 s (1.9x, 3139 files),
  pos-module-community 48.9 s → 23.3 s (2.1x, 1509 files), and 14.7 s → 12.4 s
  (1.2x, 2789 files).

  Reported offenses are identical on two of the three. The one difference, on the largest,
  is a false positive that disappears: a `{% render 'admin/users/csv/index' %}`
  resolves to `app/views/partials/admin/users/csv/index.csv.liquid`, which
  the platform renders and the candidate-path walk cannot find — `nameToPaths` generates
  only `.liquid` and `.html.liquid` for a partial, while `pathToName` strips the `.csv`
  response format, so the index knows the file by the name the tag spells and the walk
  does not. The index is right. (That asymmetry between the two functions is a separate
  bug in the walk, and it still affects callers that have no `App`.)

  Behaviour that changes:

  - Cross-file checks in the editor resolve against the whole app rather than only the
    other open tabs. With the default `includeFilesFromDisk: false` that is the
    difference between "a handful of buffers" and "the project", so `MissingPartial` and
    friends stop reporting names that exist on disk but are not open.
  - A file that exists only as an unsaved buffer now resolves. That is what makes a
    partial you just created work before you save it.
  - The file watcher is ANCHORED. It watched `**/*.liquid`, `**/*.yml`, `**/*.graphql`
    and `**/*.css`, which deliver every generator template, build artifact, seed and
    `node_modules` copy in the repository — each one read before the server found out it
    was not an app file. It now watches `APP_WATCH_GLOBS`, which is `parseAppPath`'s
    grammar as globs, derived from `FILE_TYPE_DIRS`. `app/tmp/x.liquid` is not a partial
    and is no longer reported as a change.
  - `DocumentsLocator` no longer answers for ASSETS from the app's index, even when the
    app holds them. Nothing reads an asset, so the only question asked about one is
    whether it exists — and a `stat` cannot go stale, where an index entry can (the
    lint's walk collects no assets, and the watcher deliberately does not cover them).
    The CLI and the editor therefore answer identically.
  - One unreadable file no longer costs a whole `check()` run. The read is now caught
    per file, the way the check pipelines already were.

  `ValidJSON` and `JSONSyntaxError` are REMOVED. Both are `SourceCodeType.JSON` checks,
  and a platformOS app has no JSON source: `sourceCodeTypeOf` has no `.json` row, so no
  `.json` file is ever in an `App`. They were unreachable from the CLI on master too —
  its project glob was `**/*.{liquid,graphql,yml,yaml}` — and unreachable from the
  editor since `DocumentManager` started serving `App.sourceCodes()`. `JSONCorrector`,
  `SourceCodeType.JSON` and the JSON language service are untouched; JSON responses come
  from `.json.liquid`, which is Liquid and is checked as such.

  Breaking, for anyone consuming these packages directly:

  - `App` and `appFiles()` are gone from `platformos-check-common`. Import `App` from
    `@platformos/platformos-common` (re-exported as `AppModel`), and use
    `app.sourceCodes()` in place of `appFiles(app)`.
  - `SourceCode` no longer carries `load?` / `loadedSource?`. They were optional members
    only one implementation had; read them off an `AppFile`.
  - `check()`, `autofix()`, `makeGetDefaultTranslations()`, `makeGetTranslationsForBase()`,
    `collectPartialUsages()` and `AppCheckRun.app` take/return an `App` rather than the
    union.
  - `FixApplicator` receives a `FixableSource` (`uri`, `type`, `source`) instead of a
    full `SourceCode`. No applicator ever read the AST.
  - `platformos-check-browser`'s `getApp` is gone; `simpleCheck` builds the app itself
    from `config.rootUri` and `dependencies.fs`. Its offense URIs now derive from
    `config.rootUri` instead of a hardcoded `browser:/`, and its paths must be real
    platformOS paths — the same rule the CLI and the editor apply.

- cf80cfa: Lazy `App` object model, one anchored project walk, and a `lintBuffer` that says
  whether it checked the file.

  `@platformos/platformos-common` now owns an `App` / `AppFile` model: it classifies a
  project's paths and reads or parses nothing until a consumer asks for a specific
  file. Parsers are injected, so the package stays below the parser stack and every
  consumer can share one set of file objects. Names (`{% render 'ui/card' %}`) resolve
  through an O(1) per-type index whose precedence is `getAppPaths`/`getModulePaths`
  order, i.e. the same rule the candidate-path walk uses.

  `check-node`'s `getApp` builds that model instead of reading and eagerly parsing
  every file on every call, so a `validate_code`-style single-file lint parses the file
  it visits plus the handful of render targets that file resolves — not the project.
  `check-node` also now holds one `RouteTable` per process, reconciled per run against
  each page's `mtime`/`size`, so an unchanged project costs zero page reads while an
  added, changed or deleted page is still reflected.

  That table is now also resolved LAZILY. `Dependencies.routeTable` accepts a provider as
  well as a table, `MissingPage` asks for it at the first URL it actually has to resolve
  rather than in `onCodePathStart`, and check-node passes its reconciler as the provider.
  Knowing a route means reading every page in the project, while 87-97% of the Liquid in a
  real project contains no `<a href>`/`<form action>` pointing at an internal route — so a
  lint of one of those files now touches no page at all, where before it fingerprinted
  every one of them. Warm `lintBuffer` on such a file, on a 3.1k-file project: 405 → 8
  `stat`s and 71-79 → 54-77 ms; a file that does resolve a route pays exactly what it did.
  Whole-project offenses are identical, field for field, on three real projects (9623,
  256 and 43 offenses).

  `getApp` also stops classifying. It walks the subtrees an app file can live in —
  `APP_SOURCE_SUBTREES` (`app/`, `marketplace_builder/`, `modules/*/public`,
  `modules/*/private`) with the `SOURCE_FILE_EXTENSIONS` extensions, both derived in
  `platformos-common` from the file-type model — and lets `App.fromPaths` decide what
  the app contains. One answer to "is this a platformOS file", in the package that owns
  the question: whether a file belongs to the app is its position relative to the
  project ROOT, so `tmp/app/views/partials/x.liquid` is not a partial and
  `app/views/pages/vendor/x.liquid` is a page.

  The walk therefore never enters `node_modules` and the rest of the repository at all.
  Walk time on two real projects: 903 → 33 ms and 177 → 30 ms; whole `getApp` on the same
  two, 1289 → 152 ms and 381 → 154 ms, with a file-by-file identical app on four real
  projects. `getAppFilesPathPattern` is REMOVED: it had no consumer left once the lint
  stopped globbing, and a watcher that wants patterns can build them from
  `APP_SOURCE_SUBTREES` and `SOURCE_FILE_GLOB`, which is all it did.

  `check-node` also holds one `App` per project per process, reconciled per call rather
  than rebuilt. The project walk is NOT cached — a process that gets no filesystem
  events has no honest way to invalidate one, and an agent editing files out of band is
  exactly the case this has to be right for — so the candidate paths are walked on
  every call and the app is brought in line with them: files the walk no longer sees are
  dropped, files it did not know are added, and files whose source is in memory are
  `stat`ed and dropped if they changed. Everything else — classification, both name
  indexes, and the handful of sources and ASTs the previous calls loaded — is reused.
  Warm `lintBuffer`, shared vs rebuilt per call, on two real projects: 104-116 ms vs
  177-195 ms and 77-107 ms vs 123-160 ms, with diagnostics identical file by file over 40
  files per project. At most 200 files keep their source between calls, so a long-lived
  process stops accumulating the project (300 calls on the larger: 574 MB and climbing →
  497 MB, flat). `resetSharedApp()` discards it. `lintBuffer` now reverts its buffer
  overlay when the call ends, since the app outlives it.

  `isIgnored` compiles each `ignore` pattern once per config instead of rewriting and
  recompiling a `Minimatch` on every path it is asked about — it is asked once per
  candidate path in `getApp` and again per file per check in `check()`. Same patterns,
  same answers, file-by-file identical on three real projects; the filter itself is
  5-6× faster (on one of them, 1511 candidates against 13 patterns: 76-98 → 14-16
  ms), and `getApp` there is 207-267 → 45-69 ms.

  **The dependency graph and the language server see the whole app now.** Both walked
  the project by starting at the root and skipping any directory whose name ended in
  `.git`, `node_modules`, `dist`, `build`, `tmp` or `vendor`. The last four match at any
  depth, so `app/views/pages/vendor/**` — an entire section of a live site — was invisible
  to both: every reference to those pages looked orphaned in the graph, and the language
  server managed none of them (no diagnostics, completions or rename), with nothing to
  indicate why. Measured over the projects on hand, one loses 137 app files that way and
  another 3 (`app/lib/commands/v2/projects/update/build/*`).

  They now share `walkAppSourceFiles` in `platformos-common`, which walks
  `APP_SOURCE_SUBTREES` — the same anchoring `getApp` adopted, and the same rule
  `parseAppPath` has always enforced. `recursiveReadDirectory` and its directory-name
  blacklist are gone. `getApp` walks with it too, instead of globbing the equivalent
  patterns: same paths file for file on four real projects, and 9-15% faster (median
  39 → 33 ms on the largest, 33 → 28 on another), because
  a walk filters by extension as it enumerates instead of matching a pattern per path.
  Two edge cases the glob decided and the walk now decides
  deliberately: hidden entries (`.#card.liquid`, `._card.liquid`, `.old/`) are still
  skipped, and an unreadable directory now FAILS the run rather than being skipped in
  silence.

  That failure is an `UnreadableDirectoryError`, which names the directory relative to
  the project root and says what to do about it, rather than a bare `EACCES … scandir`.
  `pos-cli check` prints it as a message and exits 1; an unexpected error still gets its
  stack. In the language server it also fixed two things that were never specific to
  permissions, and broke a session for any cause — a dropped network mount, `EMFILE` on
  a large project, a directory another process has locked. `preload` is `memoize`d, and
  `memoize` caches the REJECTED promise, so one failure replayed for every later preload
  of that root, including after the cause was gone; and `progress.end()` was on the
  success path only, so "Initializing Liquid LSP" stayed on screen for the rest of the
  session. `preload` now ends its progress, drops the memo so a retry can succeed, shows
  the user the reason (once per distinct failure per root — the graph rebuild preloads on
  every file event) and logs the error with its stack. `AppGraphManager` likewise stops
  caching a rejected graph build.

  `NodeFileSystem.readDirectory` builds each entry's URI by appending to the directory's
  (`path.childUri`) instead of parsing and re-serializing it (`path.join`). It runs once
  per entry of every directory any walk opens — tens of thousands of times per project,
  mostly for entries the caller discards — and the round trip was about a third of the
  walk. `childUri` is pinned against `join` itself for every name shape a listing can
  produce, including `#`, `?` and Windows separators.

  Anchoring is also faster than either alternative, because the walk
  never opens the directories in question: on a project with 20 000 files under
  root-level `dist`/`build`/`vendor`/`coverage`, the walk is 6 ms, against 19-23 ms for
  the blacklist as it was (which loses the vendor page) and 63-69 ms for a blacklist
  shortened to the safe names (which keeps it). On four real projects: 71-78 → 31-34 ms,
  35-38 → 30-34 ms, 20-21 → 18-19 ms, and one unchanged at 23-28 ms.

  One consequence: files outside the app subtrees — `seed/post_import/**`,
  `tests/post_import/**` — are no longer preloaded by the language server, matching what
  the linter's app has contained since `getApp` was anchored. Opening one still manages
  it, as opening any supported file always has.

  **`lintBuffer` now says whether it checked the file at all.** It returns
  `{ status, offenses }` instead of `Offense[]`. Three kinds of path are never linted —
  one the config's `ignore` list covers, one outside `app/`/`marketplace_builder/`/
  `modules/<name>/(public|private)/`, and an asset with no parser or checks — and each
  used to come back as an empty `Offense[]`, which is exactly what a clean file returns.
  For `pos-cli check` that is harmless; for an agent asking "is this file OK before I
  write it?" it is the wrong answer given confidently. `status` is `checked`,
  `excluded-by-config`, `not-an-app-file` or `not-a-source-file`, and `offenses` is empty
  for all but the first. `pos-cli check`'s own behaviour is unchanged — it goes through
  `appCheckRun`, not this seam. The MCP supervisor carries the reason into
  `next_step` until its result contract grows a status of its own.

  **VS Code now sends YAML buffers to the language server.** `documentSelectors` had no
  `yaml` entry, so translations, tables, user profile types and transactable types got no
  diagnostics, completions or go-to-definition — the server has handled them all along.
  The selectors are now derived from `SOURCE_FILE_EXTENSIONS`, with the `.yml` pattern
  anchored to `app/`, `marketplace_builder/` and `modules/` so that a
  `.github/workflows/ci.yml` is not handed to the language server. The dead `json`/`jsonc`
  selectors are gone: they matched Shopify's `{config,locales,sections,templates}` layout,
  and `JSONLanguageService` has nothing to serve, since platformOS publishes no JSON
  schemas.

  **Classification is anchored at the project root, and the extension is part of it.**
  Three changes that together make `platformos-common` the single answer to "is this a
  platformOS file, and if so what kind".

  `getFileType(uri, rootUri)` now REQUIRES a root, as does every `isPage` / `isPartial` /
  `isLayout` / `isAsset` / `isKnown*File` / `isSupportedSourceFile` predicate. A platformOS
  file is one whose position RELATIVE TO THE PROJECT ROOT matches the directory structure,
  so a classifier without a root cannot answer the question — it can only test whether a
  known directory name appears somewhere in the string. That is how
  `seed/post_import/app/migrations/20220517145452_index_rebuild.liquid` came to be a
  Migration to the language server, the graph and the VS Code extension while being
  correctly absent from the lint's app: it contains `app/migrations/` and is not deployed,
  so nothing it renders or queries exists to resolve, and every diagnostic on it was noise
  about a file the platform will never run. Callers get their root from what they already
  hold — checks from a new `context.fileType(uri?)` (which reads `AppFile.fileType` off the
  run's App, so the common path re-derives nothing), the graph from `AppGraph.rootUri`, the
  language server from `findAppRootURI`. **This is a breaking API change** for anything
  calling those exports directly.

  Classification also consults the EXTENSION now, mirroring each backend model's
  `PHYSICAL_PATH`: `app/graphql/x.yml` and `app/translations/en.json` are no longer a
  GraphQL file and a Translation. Page, Layout, Partial and Asset stay permissive, because
  `page.rb` and `instance_view.rb` are `(.+)` with no extension anchor — `app/views/pages/home.html`
  is a Page the platform deploys and the linter cannot read. **`.yaml` is no longer a
  platformOS extension**: every YAML model anchors `\.yml\z`, so `SOURCE_FILE_EXTENSIONS`
  is now `.liquid`, `.yml`, `.graphql`, and a project with `app/translations/en.yaml` stops
  getting diagnostics for it — that file was never deployed. `ActivityStreamsHandler` and
  `ActivityStreamsGroupingHandler` are new file types.

  **There is no ignore list left.** `isSupportedSourceFile` is the intersection of two
  whitelists — the platform deploys it, and we have a parser for it — and nothing else. It
  used to open with a `/\.(s?css|js)\.liquid$/` test, and an ignore list is only consulted
  by the callers of whoever holds it: the language server refused `theme.css.liquid` while
  the lint put it in the app with the Liquid+HTML parser and reported
  `LiquidHTMLSyntaxError` on it. A file we cannot parse is now one with no row in the
  parser table, which is keyed on the RESPONSE FORMAT for `.liquid` files, because the
  format is the body language. `users.json.liquid` is parsed; `theme.css.liquid` and
  `run.js.liquid` are not, by either tool. `.scss.liquid` changes the other way: `scss` is
  not in the platform's FORMAT_ENUM, so that file is a partial named `x.scss` and is now
  linted.

  App file sets and per-check offense totals are identical before and after on four real
  projects (946 files / 43 offenses, 3139 / 9623, 2789 and 2895).

  Behaviour changes worth knowing about:

  - **`OrphanedPartial` is REMOVED**, and with it the `singleFileOnly` check partition
    it was the only member of. It asks "is any file rendering this partial?", which no
    index answers without every Liquid file parsed — and, once wired up and measured, it
    answered wrongly too often to ship: 231 hits on a module project, every one of
    them a module's `public/` API whose callers live in other repositories; and on a
    large site a large share of the 465 hits were partials invoked BY NAME, either through
    a dispatcher (`mutation_name: 'authentications/delete'`) or as a callback
    (`access_callback: 'lib/can/theme_manage'`), which static analysis cannot see. A
    warning that is wrong that often is one nobody reads.

    Removing it removes the reason for the partition: every remaining check answers for
    one file, resolving against the project through indexes that are already cached
    (`MissingPage` through the route table, `MissingPartial` through the name index).
    So `CheckOptions.singleFileOnly`, `meta.singleFile` and `Dependencies.getReferences`
    are gone, and the editor, `pos-cli check` and `validate_code` now run exactly the
    same set of checks. `validate_code`'s `mode: full | quick` input is REMOVED with it:
    the partition was the only thing it could have selected. Unknown arguments are
    dropped by the MCP SDK, so a caller that still sends `mode` gets the same result it
    always did.

  - Translation lookups now treat "an open editor buffer" as a file with a defined
    `version`, rather than any file present in the app object. Contents are otherwise
    read from the filesystem.
  - Six packages that imported `@platformos/*` siblings without declaring them now do
    (they had resolved only through workspace hoisting).

  **The language server holds the same `App`, so opening a workspace no longer parses
  it.** `DocumentManager` was a second, LSP-shaped store of source codes beside the
  model — its own `Map<uri, AugmentedSourceCode>`, and a `preload` that read AND eagerly
  parsed every file in the project. It now holds one `App` per project root and delegates:
  `open`/`change` are `setSource`, `delete`/`rename` go through the App's own index (so
  deleting an `app/modules/X` overwrite promotes the `modules/X` original back), and
  `app(root, includeFilesFromDisk)` is `App.sourceCodes()` — the same intersection
  `isSupportedSourceFile` names, asked of a file that classified its own path once
  instead of re-derived per call per predicate. `preload` classifies the walk's paths
  (no I/O), reads the ones with a parser, and parses nothing; an `AppFile` parses on the
  first `ast`.

  Measured through the real language server on a 2735-liquid-file project —
  `initialize` → `didOpen` → the first `publishDiagnostics` — median of five runs: first
  diagnostic 17,742 → **771 ms**, first completion 191 → 187 ms, RSS 705-720 → **333-347
  MB**, with byte-identical diagnostics. One cost MOVES rather than disappearing: a
  whole-project graph build now pays for the parses `preload` used to
  (`appGraph/dependencies` 198 ms → 11.5 s there, one-time — the ASTs stay on the
  files, so the next request is 1 ms). Total time to a graph still falls, 18.0 → 12.4 s,
  and it is off the startup path.

  `set()` also classifies WITH a root now, like every other consumer: the app a URI falls
  under supplies one, so "is this part of an app" is asked the way `getFileType`, the
  checks and the graph ask it. A readable file the platform does not deploy
  (`scripts/build.liquid`) is still an editor document — formatting, hover, completions —
  and is in no `App`, so it gets no diagnostics and no graph node.

  **The graph and the checks now parse each file once, not once each.** `AppGraphManager`
  builds its `getSourceCode` with `appBackedGetSourceCode(app, fallback)`, and the app is
  built with check-common's `sourceParsers` merged with the graph's `.js`/image entries,
  so both halves of the process hold the SAME `AppFile` instances. `sourceParsers` is new
  and is the single definition of how a file becomes an AST; check-node's `nodeParsers` is
  now an alias for it. The graph's `toSourceCode` remains as the path for a caller holding
  a buffer and no app — an in-flight `validate_code` buffer, a URI outside the project —
  which by definition has no `AppFile`.

  Two bugs fixed on the way, both of which cost cross-file diagnostics silently:

  - `runChecks` never waited for `preload`, so the first check of a session could run
    against a project that had not been read and quietly miss every diagnostic that
    depends on another file's `{% doc %}`. It got away with it only because `preload` was
    slow enough to monopolise the event loop.
  - A file the workspace could not READ stayed in the app with no contents, and
    `AppFile.source` throws rather than returning `''`. One unreadable file therefore cost
    the whole run. A file is a document here exactly when its contents are in memory,
    which is the set the old `Map` held.

  **A malformed translation file no longer costs a project its document links.**
  `TranslationProvider` let `yaml.load` throw, and a duplicated mapping key — two people
  adding the same key, which real projects have — made `textDocument/documentLink` reject
  for the whole file: the `render` links disappeared along with the translation ones, while
  hover and go-to-definition kept working because they are separate requests. Parse
  failures are values here now, the same contract `AppFile.ast` and `toYAMLAST` keep; an
  unparseable translation file contributes no translations, exactly as a missing one does,
  and the linter still reports the syntax error against the file that has it.

### Patch Changes

- a8f4da9: An asset is served, never rendered — so nothing reads one, anywhere in the toolchain.

  `app/assets/x.liquid` was linted like a page. A bare `.liquid` has no response format, so
  `sourceCodeTypeOf` falls back to the `html.liquid` key — which HAS a parser row — and the
  file went into the app with the Liquid+HTML parser. Measured: a broken one drew
  `LiquidHTMLSyntaxError` from `check()`, and through the MCP supervisor a
  `must_fix_before_write: true` — a **false block** on a file the platform hands back
  byte-for-byte, for the syntax of a language nothing at that path evaluates. Backwards
  besides: `theme.css.liquid`, the asset form the platform genuinely does process, was exempt
  all along, because `css` IS a format and has no row.

  **The rule is a TYPE question, which is why an extension table could never answer it.**
  `isParsedFileType` (new, exported from `platformos-common`) is false for
  `PlatformOSFileType.Asset` and true for everything else. `App.findOrLocate` had already
  written the principle down — _"Nothing reads an asset, so the only question about one is
  whether it exists"_ — this makes it enforceable.

  Applied in exactly two places, and that is the whole design: `AppFile`'s constructor (so a
  file's `type` is `undefined`, which is already the toolchain's canonical "do not parse
  this") and `isSupportedSourceFile`. Every consumer follows from one of those two without
  knowing the rule exists — the linter, because `check()` iterates source types; the language
  server, because `App.sourceCodes()` filters on `type !== undefined`; the MCP supervisor,
  whose pre-lint gate now asks the shared predicate instead of comparing to `Asset` itself.

  An asset is still HELD by the app, and the distinction matters: not linted is not absent.
  Dropping assets from the model would produce the same zero offenses while silently breaking
  every `asset_url` resolution and the graph's asset nodes.

  **Why an explicit exclusion of one type rather than a whitelist of the other eighteen.**
  A whitelist gives a NEW `PlatformOSFileType` the default "not read", which is silent and
  wrong in the expensive direction — a newly added YAML type would simply stop being linted,
  the exact regression `file-type-coverage.spec.ts` exists to catch. Defaulting a new type to
  "read" fails loudly instead.

  This is also not the ignore-list that `isSupportedSourceFile` is documented to refuse. That
  one was a regex inside a single predicate, so the language server honoured it while the lint
  did not; this is a shared exported rule consulted by both deciders, so they cannot hold
  different opinions.

  Closes the write-gate half shipped earlier as a supervisor-only fix, which corrected
  `must_fix_before_write` while the CLI and editor still reported on assets.

- 7e7f1cd: Close the file-identity gaps outside `platformos-common` — five places that still
  classified or named platformOS files themselves, each wrong in a way the
  directory-name guard could not see:

  - **Rename handlers use logical names.** `partialName`/`assetName` were
    `path.basename(uri, '.liquid')`, which flattens nested and module names: renaming
    `views/partials/ui/card.liquid` computed `card`, missed every
    `{% render 'ui/card' %}` call site, and rewrote a top-level `card` partial's
    arguments instead. All three consumers (partial rename, asset rename, `{% doc %}`
    param rename) now resolve through `pathToName`. Asset names now keep their FULL
    filename, `.liquid` included — the backend's `AssetName` strips only the directory
    prefix; the `.liquid`-stripping was Shopify's rule, not platformOS's.

  - **The `home` page deprecation is a page-and-name question, not a filename one.**
    `ValidFrontmatter` flagged ANY file named `home.html.liquid` — partials, emails,
    nested pages — and missed `home.liquid`. It now fires exactly when a Page's
    logical name spells the deprecated root alias (`isDeprecatedHomeAlias`, new in
    the route-table next to the slug rule it restates), module pages included,
    `blog/home` and partials excluded.

  - **`findRoot` recognizes the legacy root.** The root markers were `.pos`, the
    config file, `app/` and `modules/` — not `marketplace_builder/`, so a legacy
    project without a sentinel resolved no root at all: no diagnostics, no
    completions. The markers now come from `APP_ROOTS` (newly exported), legacy
    included.

  - **Every translation lookup covers both roots and both layouts.** `getDefaultTranslations`
    hardcoded `app/translations/en.yml`; a `marketplace_builder/`-rooted project or a
    split-file layout (`translations/en/*.yml`) silently got `{}` as its reference
    translations. It now goes through `TranslationProvider` over
    `getAppPathsAcrossRoots(Translation)` (new), first root with content wins — and
    `TranslationProvider.getSearchPaths` itself now derives from
    `getAppPathsAcrossRoots`/`getModulePaths` instead of hardcoding `app/translations`,
    so `TranslationKeyExists` and translation go-to-definition see a legacy-rooted
    project's translations too. The reference locale is the exported `DEFAULT_LOCALE`
    rather than four scattered `'en'` literals, and the new `uriToName(uri, rootUri)`
    is `pathToName` for callers holding a URI and its root.

  - **Nested asset renames reach the handler.** The LSP's file-operation filter was
    `**/assets/*`, and a single `*` does not cross `/`, so renaming
    `app/assets/js/app.js` never fired the rename handling at all. The glob is now
    `ASSET_FILE_OPERATION_GLOB` (`**/assets/**`), derived from `FILE_TYPE_DIRS` in
    `platformos-common`.

- f644a30: The graph resolves reference names through the `App` index its caller already holds.

  `IDependencies` gains `app`, the companion to `getSourceCode`: a caller that has an
  `App` hands it over for BOTH, so a graph build reuses the project model's parses AND its
  name index. `traverse.ts` passes it to `DocumentsLocator`, and the language server's
  `AppGraphManager` supplies the same `App` it already reads sources through.

  It cannot change the ANSWER, only its cost. `App.findOrLocate` is index-first and falls
  through to the very candidate walk the walk-only stand-in performs, in
  `getAppPaths`/`getModulePaths` order either way — so an index that is empty, partial or
  stale resolves exactly as before. What it removes is the I/O: without an app, every
  `{% render %}`, `{% include %}`, `{% function %}`, `{% background %}`, `{% graphql %}`
  and `layout:` in the project costs one `readDirectory` per candidate DIRECTORY, on a
  project the language server had just walked and indexed. Measured over a whole-project
  build on three real projects — directory listings, then median wall clock of three runs,
  with the graph compared node-for-node:

  | project              | files | listings        | build         |
  | -------------------- | ----- | --------------- | ------------- |
  | project-a            | 3450  | 6993 → **590**  | 12.1 → 11.7 s |
  | project-b            | 3623  | 9911 → **185**  | 7.3 → 7.1 s   |
  | pos-module-community | 1622  | 11787 → **762** | 4.8 → 4.0 s   |

  Identical graphs on all three. **The wall-clock win is the small half** (3-15%): a full
  build is dominated by parsing every reachable file, and no index changes that. What goes
  away is 92-98% of the I/O, which is the part that scales with how many references a
  project has rather than how much source it has. The listings left are the two that must
  remain: an asset lookup (never indexed — nothing reads an asset, so the only question is
  whether it still exists on disk) and a name the index genuinely cannot answer.

  Graphs are also pinned identical across three arms in the suite — a whole app, no app,
  and an app holding only the entry points, so that every target is an index miss — on both
  the plain and the module-prefixed fixtures.

  Two comments corrected while measuring this, both of which pointed the next reader the
  wrong way:

  - `graphParsers` claimed the MCP supervisor was a "consumer-to-be" of
    `appBackedGetSourceCode`. It is not, and the reason is now written down: its full
    builds run on a worker thread (a second heap on purpose) which cannot share `AppFile`
    objects at all, and its incremental apply must not read through check-node's shared
    `App`, which carries unsaved editor buffers and is mutated by concurrent lints while
    the graph cache is an authority on DISK state. There is also nothing to win —
    `lintBuffers` parses the content it was handed and drops the app's entry for that file
    on the way out, so the file a reconcile parses is precisely the one whose parse no lint
    would have reused.
  - The same doc implied a graph build needs the `.js`/image parsers. It does not:
    `traverseModule` returns immediately for an Asset node and the only fact the graph
    wants about an asset is whether it exists (`fs.stat`). Every file a build READS is
    Liquid, GraphQL or YAML, so `sourceParsers` alone is enough to back one. The entries
    exist for `toSourceCode`'s total contract and for an `App` that an asset URI is put
    into. Pinned by a test asserting the build asks for no asset source code, with the
    Liquid files it does read as the control.

- a8f4da9: How a platformOS GraphQL document is READ now lives in `platformos-common`, and a
  `.graphql` file is parsed exactly once until its source changes.

  `parseGraphql`, `extractGraphqlTables` and `extractGraphqlVariables` are platformOS
  domain knowledge — what a table filter looks like, what a `{% graphql %}` call site may
  and must pass — so they sit beside `extractSchemaTable`, the schema `name:` those tables
  join to, rather than inside the linter. `platformos-check-common` no longer defines
  `graphql-table.ts` and re-exports none of them; it re-exports only the
  `GraphQLDocumentNode` TYPE, exactly as it re-exports `SourceCodeType`.

  **The placement is what makes the parse shareable.** The GraphQL "AST" an `AppFile` held
  was `{ type: 'Document', content }` — the source string, unparsed — so every consumer
  parsed it again for itself:

  - `GraphQLCheck`, once per file per run;
  - `GraphQLVariablesCheck`, one `fs.readFile` **plus** one parse per `{% graphql %}` call
    site — which also meant it read the disk while the editor held an unsaved buffer;
  - `UnknownProperty` and the language server's type system, one parse per call site;
  - the graph build, one more.

  `sourceParsers` now injects `parseGraphql`, so the `AppFile` memoizes the real document
  and all four read that one. Measured on a real project (`project-c`, 453 `.graphql` files)
  by counting every call into `graphql`'s `parse` during a full CLI run: **2442 parses
  before, 505 after**, for the same 15511 offenses. Wall clock is unchanged within noise
  (115.9 s → 114.1 s) — a full lint of that project is dominated by Liquid parsing, so this
  is a cost removed rather than a speed-up to advertise. It matters most where the same
  document is read over and over against a warm app: the language server's per-keystroke
  type inference, and the MCP supervisor's per-write `validate_code`.

  `GraphQLDocumentNode` gains `document?` and `syntaxError?` alongside `content`, which is
  unchanged — a document that does not compile is a normal state `GraphQLCheck` reports
  on, so the error is a value on the node rather than the `Error` a parser may return,
  which would take the file out of the very pipeline that reports it.

  **`GraphQLCheck` now reports a syntax error even when the docset has no schema.** It used
  to gate the whole check on `platformosDocset.graphQL()`, so a document that did not
  compile drew nothing — and the test pinning that silence used a syntactically VALID
  fixture, so nothing distinguished "no schema to compare against" from "says nothing at
  all". A syntax error needs no schema; only `validate()` does. This changes no Node run:
  the docs manager downloads the schema to its cache and falls back to the copy committed
  in `platformos-check-docs-updater/data/graphql.graphql`, so `null` reaches the check only
  from a caller that injects its own docset — a browser embedder, or a test. The silence
  that remains (an unknown FIELD, without a schema) now has that syntax test beside it as
  its control.

  Callers with a buffer and no file — an inline `{% graphql res %}…{% endgraphql %}` body
  — call `parseGraphql` directly. There is no cache inside it: the `AppFile` is the cache,
  and a second content-keyed one behind it would be a different answer to what a file's
  parse is.

  `inferShapeFromGraphQL(node, schema?, args?)` and `ShapeAnalyzerDeps.readGraphQL` now
  take and return the parsed node instead of a string.

  The language server's `TypeSystem` takes an optional App resolver (`CompletionsProvider`
  passes `DocumentManager.appModel`) and reads through the `AppFile` its own diagnostics
  already parsed — for `.graphql` documents and, by the same `readLiquidFile`, for the
  LIQUID PARTIALS behind `{% function %}`, which were read and re-parsed by BOTH the shape
  analyzer's `readPartial` and `inferFunctionReturnType`, once per call site, per request.
  So completion and hover cost a lookup instead of a read and a parse, and cannot disagree
  with the diagnostic beside them about what a partial says. A host with no app (the hover
  provider builds a type system without even a filesystem) still reads and parses, but once
  per symbols table now rather than once per call site.

  Pinned by `graphql-parse-once.spec.ts`, whose fixture makes the app's parse
  unreproducible — the source carries a token that is not GraphQL and the injected parser
  strips it — so a consumer that parses the file, the buffer or `ast.content` again is
  visible in the offenses, not merely in a counter. The language server's path is pinned the
  same way: its fixture puts a document in the App that the filesystem does not have, so a
  read that went to disk infers the wrong shape. `platformos-common`'s
  `package-boundaries.spec.ts` now states the invariant it always meant: no workspace
  parser package and no Node import, rather than "no parser" — `js-yaml` was already there
  for the same reason `graphql` is now.

- cf80cfa: One answer to "what shape does this variable have", shared by the check and the editor.

  `VariableShapeExtractor.ts` and the shape tracking inside `TypeSystem.buildSymbolsTable`
  were a drifted copy of `UnknownProperty`'s analyzer, and carried every bug TASK-58 fixed:
  `hash_assign` onto an unknown variable fabricated a hash holding only that key, lvalue paths
  and `<<` were not writes at all, a `parse_json` body with interpolation and a filter after
  `parse_json` were taken at face value, and GraphQL fragment spreads, inline fragments and
  `@include`/`@skip` were ignored — so completion offered a fragment's nine fields as none.

  `VariableShapeExtractor.ts` turned out to have no importers anywhere in the monorepo and was
  deleted rather than fixed, along with `graphqlSchema.ts`, whose only consumer moved with the
  GraphQL inference. `PropertyShapeInference.ts` is now presentation only. check-common exports
  `checks/unknown-property/{property-shape,shape-analysis}` and `buildSymbolsTable` asks ONE
  `createShapeAnalyzer` — 811 lines lighter, with argument-bound `{% function %}` return shapes
  and their memoization for free.

  Two seams keep the editor's own knowledge without a second tracker. `ShapeAnalyzerDeps`
  gained an optional `resolveExternalShape`, which is how the docset reaches a hash literal
  (`{ "user": context.current_user }`); a check passes nothing and gets exactly its previous
  answers. And `resolvedTypeToShape` no longer fabricates: a documented object is a TYPE, not
  a shape, and flattening `context` or `product` into one said "some value" while costing the
  caller the docset entry hover and completion resolve from.

  The `open`-for-writes question this raised is now decided. A write at a path onto a base with
  no known shape produces an OPEN object carrying the written key, so completion offers the key
  while no other read can be called unknown. `PropertyShape` gained `placeholder` to keep the
  two open-nesses apart: an empty hash literal is a placeholder and CLOSES on the first visible
  write — which is what makes `{% assign f = {} %}{% hash_assign f['page'] = 1 %}{{ f.tag }}`
  reportable — while a shape that is open because we never saw the value stays open through any
  number of writes. Without that distinction the new open shapes were silently closed on the
  second write, worth 22 false positives on one real project.

- 280a66f: A theme directory created while the editor is open now resolves, and the two remaining
  consumers that read a project file behind the `App`'s back read through it.

  **The language server served a stale directory listing until it was restarted.** A dynamic
  theme search path (`theme/{{ context.constants.THEME }}`) expands by LISTING the directory
  above it, and both that listing and the expansion computed from it were cached with
  `app/config.yml` as their only invalidation point — while adding a theme does not touch
  `app/config.yml`. Two caches had to be corrected, and fixing either alone changes nothing:

  - the created/deleted file's whole ANCESTOR chain is now dropped from the `readDirectory`
    cache, not just its immediate parent. The client reports the FILE, so writing
    `theme/v2/card.liquid` invalidated `theme/v2` and left the listing of `theme/` — the one
    the expansion reads — cached. Walking to the scheme root needs no project root to stop at
    and costs nothing: dropping a listing nothing cached is a `Map.delete` miss.
  - the expanded search paths are dropped on a created or deleted file, for the same reason.

  Reproduced end to end in `server/startServer.spec.ts`: go-to-definition on
  `{% theme_render_rc 'card' %}` answered `null` after the theme was replaced, and now finds
  the new one. `DocumentsLocator.spec.ts` keeps the other half honest — its clear-the-cache
  test asserted only that clearing left the answer unchanged on an UNCHANGED tree, which
  passes with `clearExpandedPathsCache` reduced to an empty body; it now records all three
  answers (fresh, stale, recovered), and its mock filesystem derives the tree per call so a
  test can add or remove a file mid-run at all.

  **`NestedGraphQLQuery` was the one check that never consulted the `App`** — it located a
  partial, then read it with `fs.readFile` and parsed it itself, so a partial named from ten
  call sites was read and parsed ten times, and an unsaved buffer was invisible to it. It now
  takes the `AppFile`'s parse when the app has one, keeping the `fs` fallback for a URI
  outside the walked subtrees. `index.spec.ts` proves WHICH parse it uses rather than just
  counting: the app's parser rewrites a marker, so the offense can only appear if the check
  read the app's AST — bypassing it yields no offenses at all.

  **`backfill-docs` held an `app` and still read and parsed the partials itself.** It now
  reads through it, and the command finally has a spec of its own: what it writes, and that
  an unsaved buffer in the app is what gets documented.

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
- Updated dependencies [f644a30]
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
  - @platformos/platformos-common@0.1.0
  - @platformos/platformos-check-common@1.0.0
  - @platformos/platformos-graph@0.1.0
  - @platformos/liquid-html-parser@0.1.0

## 0.0.19

### Patch Changes

- Improved checks
- Updated dependencies
  - @platformos/platformos-check-common@0.0.19
  - @platformos/liquid-html-parser@0.0.17
  - @platformos/platformos-graph@0.0.19

## 0.0.18

### Patch Changes

- Additional checks and improvements
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.16
  - @platformos/platformos-check-common@0.0.18
  - @platformos/platformos-graph@0.0.18

## 0.0.17

### Patch Changes

- Updated dependencies
  - @platformos/platformos-check-common@0.0.17
  - @platformos/platformos-graph@0.0.17

## 0.0.16

### Patch Changes

- Improved Liquid Linting
  - Better metadata params validation — Reworked detection of undefined variables in page/partial metadata parameters, reducing false positives
  - Improved undefined object detection — More accurate identification of undefined objects in Liquid templates
  - Fixed invalid property detection — The unknown-property check now correctly catches more cases of invalid property access on objects

- Updated dependencies
  - @platformos/liquid-html-parser@0.0.15
  - @platformos/platformos-check-common@0.0.16
  - @platformos/platformos-graph@0.0.16

## 0.0.15

### Patch Changes

- ctrl+click fix
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.14
  - @platformos/platformos-check-common@0.0.15
  - @platformos/platformos-graph@0.0.15

## 0.0.14

### Patch Changes

- better ctrl click, more checks
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.13
  - @platformos/platformos-check-common@0.0.14
  - @platformos/platformos-graph@0.0.14

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
  - @platformos/liquid-html-parser@0.0.12
  - @platformos/platformos-check-common@0.0.13
  - @platformos/platformos-graph@0.0.13

## 0.0.12

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.11
  - @platformos/platformos-check-common@0.0.12
  - @platformos/platformos-graph@0.0.12

## 0.0.11

### Patch Changes

- @platformos/platformos-graph@0.0.11
- @platformos/platformos-check-common@0.0.11

## 0.0.10

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.10
  - @platformos/platformos-check-common@0.0.10
  - @platformos/platformos-graph@0.0.10

## 0.0.9

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.9
  - @platformos/platformos-check-common@0.0.9
  - @platformos/platformos-graph@0.0.9

## 0.0.8

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.8
  - @platformos/platformos-check-common@0.0.8
  - @platformos/platformos-graph@0.0.8

## 0.0.7

### Patch Changes

- Update dependencies
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.7
  - @platformos/platformos-check-common@0.0.7
  - @platformos/platformos-graph@0.0.7

## 0.0.6

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.6
  - @platformos/platformos-check-common@0.0.6
  - @platformos/platformos-graph@0.0.6

## 0.0.5

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.5
  - @platformos/platformos-check-common@0.0.5
  - @platformos/platformos-graph@0.0.5

## 0.0.4

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.4
  - @platformos/platformos-check-common@0.0.4
  - @platformos/platformos-graph@0.0.4

## 0.0.3

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.3
  - @platformos/platformos-check-common@0.0.3
  - @platformos/platformos-graph@0.0.3

## 0.0.2

### Patch Changes

- Beta release
- Updated dependencies
  - @platformos/liquid-html-parser@0.0.2
  - @platformos/platformos-check-common@0.0.2
  - @platformos/platformos-graph@0.0.2
