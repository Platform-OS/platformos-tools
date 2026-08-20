# @platformos/platformos-common

## 0.1.0

### Minor Changes

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

- 8f1beea: `check` refuses a path that is not a project root, instead of reporting it clean.

  `appCheckRun` handed its argument to `getAppAndConfig` as the project root without checking that
  it was one. A directory carrying no marker — true of `app/`, and of any single module directory —
  loaded zero files, so the run returned zero offenses and every caller printed "No offenses found".
  That is indistinguishable from a clean project, and it is the dangerous direction: a developer, a
  CI job or an agent gating on that message concludes the code is clean when nothing was inspected.

  Measured on a real app: `pos-cli check run` reported 1036 offenses across 191 files, while
  `pos-cli check run app` on the same project reported none — with a partial containing an unclosed
  `{% if %}`, an unclosed `<div>` and an undefined filter sitting inside `app/`.

  It now names what happened and where the root is — and says only as much as the evidence supports.

  A root DECLARED by a `.pos` or `.platformos-check.yml` file is asserted:

  ```
  Nothing was checked: /project/app is not the root of a platformOS project.
  Re-run the check against the project root: /project
  ```

  A root INFERRED from a directory NAME is not. `app`, `modules` and `marketplace_builder` are
  ordinary names — a checkout of module repositories under `~/Work/modules` makes `~/Work` resolve as
  a project root, and a Windows machine shipping `C:\Modules` makes the drive root resolve as one —
  so stating it as fact sends people to re-run against a tree that is not their project:

  ```
  Nothing was checked: /home/me/Work/multiproj is not a platformOS project root.
  A project root contains one of: app/, marketplace_builder/, modules/, .pos, .platformos-check.yml.
  The nearest above it is /home/me/Work, matched on modules/ alone — that may not be your project.
  Re-run the check against your project root.
  ```

  `resolveProjectRoot` reports which marker matched, and `isDeclaredRoot` distinguishes the two.
  The message names no tool: the same text reaches pos-cli, the editor through the VS Code extension,
  and any embedder, so naming one of them would be wrong for the other two.

  The refusal is a typed `ProjectRootError` carrying a stable `PROJECT_ROOT_ERROR_CODE`, so a consumer
  can present it as a message rather than a crash without matching on prose or on `instanceof` — the
  latter throws outright when the loaded copy of this package predates the class.

  **It reports rather than resolving.** Widening the run to the enclosing root would check MORE than
  was asked — `check run app` would pull in `modules/`, so a run meant for one app reports offenses
  from vendored code its caller does not own, and a CI job scoped to `app/` starts failing on its
  dependencies. `platformos-graph` can resolve-and-proceed because the graph of a project is the same
  answer wherever you point at it inside the project; "check this directory" is not. Linting an
  arbitrary subtree remains unsupported and is a separate feature: it would have to load the whole
  project anyway, since partials, pages and config all resolve project-wide, and then filter what it
  reports.

  `findRoot`, `makeFileExists` and the new `resolveProjectRoot` / `PROJECT_ROOT_MARKERS` moved from
  `platformos-check-common` to `platformos-common`. They are project-LAYOUT knowledge with nothing
  linter-specific in them, and every constant they run on — `APP_ROOTS`, `STANDALONE_MODULE_ROOTS`,
  `APP_SOURCE_SUBTREES` — already lived in `platformos-common`, alongside `AbstractFileSystem` and
  the URI helpers. They are re-exported from `platformos-check-common`, so existing imports keep
  working. `platformos-graph` drops its own copy of the resolution and calls the shared one; its
  error message is unchanged, which its existing assertion on that exact string proves.

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

- d7374a8: Three per-run overheads removed from the lint, and a retention cap sized for a workload nobody runs.

  Profiling a whole-project lint of a real 1509-file project (454 offenses, ~11 s) found that ~1.2 s of
  it was bookkeeping rather than analysis, and that the first call's reads and parses were thrown away.
  None of this is the parser — parsing is 56% of the run and is a separate problem.

  **`isIgnored`: 849 ms → 55 ms, over the same 51,201 calls.** `check()` asks it once per (file, check),
  and a project's global `ignore` is the same list for all 39 liquid checks, so those 12 patterns were
  re-matched 39 times per file — each time preceded by a `uriFromPathOrUri` conversion, which made
  `vscode-uri` 225 ms of self time on its own. The compiled matchers were already cached per
  (config, check); the matching was not. The global verdict is now memoized per file, keyed on the
  subject as the caller spelled it so a hit skips the conversion too, and a check's own patterns are
  compiled alone and consulted only when it declares any — which also stops the global list being
  compiled once per check on top of everything else.

  Verified rather than argued: the previous implementation, inlined as an oracle, agrees on **all 67,770
  (file, check) pairs** of that project — 25,290 ignored under both — and on a second project that
  configures no `ignore` at all, which exercises the zero-pattern early return.

  **`findNearestKeys`: 374 ms → 23 ms, for SEVEN suggestions.** Each call ran `levenshtein` against all
  ~977 translation keys, and `levenshtein` allocated a fresh `(a+1)×(b+1)` matrix per candidate — ~50 µs
  to compare two short strings, and a visible share of the run's 706 ms of GC. It now uses two reused
  rows, and `findNearestKeys` rejects a candidate on its length difference before the O(n·m) comparison,
  since a length gap is a lower bound on the distance. Same results: a differential against the matrix
  implementation agrees on every pair of a spanning set, and the boundary — a key whose length differs by
  exactly `maxDistance`, which must still be offered — is its own test, because a pre-filter written with
  `>=` passes every "nothing was suggested" assertion otherwise.

  **Warming up took two whole passes, not one.** The freshness baseline was established by the first
  revalidation AFTER a read, which therefore could not vouch for what it found and dropped it — so the
  second call re-read and re-parsed everything the first had read. `AppFile.load()` now stats immediately
  before it reads and keeps that as `loadedStat`, so a file read on call N is already vouched for on call
  N+1 and is kept.

  The order within the read is a correctness property, not a preference. Taken before, the worst case is
  a baseline describing an OLDER state than the content, which fails the next comparison and re-reads.
  Taken after, it could describe a write that landed during the read, and pairing that with the older
  content in hand is exactly how a cache comes to serve stale source — so `App.spec` asserts the call
  order directly, since no unit test can schedule that race.

  Four lints in one process went from 13558 / 11513 / 8666 / 9869 ms to 13359 / **3449** / 3271 / 3245 —
  warm on the second call, and 3.9× faster once warm. A single-buffer `lintBuffer` on the same file three
  times went from 863 / 652 / 112 ms to 843 / **110** / 113. `pos-cli check run -a` runs `appCheckRun`
  twice in one process, so the CLI pays this too.

  **The measurement that justified the old order was right about its number and wrong about its
  denominator.** It read "+25% on whole-project commands", and +25-31% is what an extra stat costs the
  READ PHASE — which is 122 ms of a ~10 s lint. Best of six interleaved rounds over 1509 files: 122 ms
  without, 160 ms with. 37 ms of stat against ~7 s of discarded parses.

  **`MAX_RETAINED_FILES`: 200 → 10 000.** At 200 it was sized for the single-buffer lint that dominates a
  long-lived process — 37 files for a real layout — and it priced whole-project work out of any reuse:
  a repeated project-wide lint ran 8.4 s instead of the 4.1 s it costs with its parses still in hand.
  A retained file holds its source and its AST at ~33 KB, so the whole 1509-file project costs +21 MB of
  heap and a 6027-file project +200 MB; a cap still has to exist, but 200 was two orders below what it can
  afford. The per-call price of a higher ceiling is revalidation's stat sweep at ~21 µs/file, so a fully
  retained 10 000-file project would add ~200 ms per call — the number to weigh before raising it again.

  Offense output is byte-identical on two real projects (454 and 149 offenses; uri, check, severity,
  start, end and message compared), against a baseline rebuilt on the same commit — which matters,
  because the session's first baseline was taken against a stale `dist` predating a 39th liquid check, and
  that showed up as the `isIgnored` call count moving rather than as any offense difference.

  One consequence worth knowing: `shared-app.spec` derives its over-cap project from
  `MAX_RETAINED_FILES`, so it now materializes 10 020 temp files and takes ~6.7 s. That keeps it faithful
  to the real cap, but it scales with any further raise; making the cap injectable is the alternative if
  that becomes annoying.

### Patch Changes

- cf80cfa: Read a translation file the way the platform does, and report the YAML problems nothing
  reported before.

  A duplicated mapping key is what a real project produces when two translators add the same
  key. Strict js-yaml rejects the whole document for it, and every reader in the toolchain
  turned that rejection into "this file has no translations" — silently. On one real project
  five of the 39 `app/translations/en/*.yml` files have a duplicate, and the two checks that read
  the resulting key set paid for it: **561 of `MatchingTranslations`' 621 offenses and 676 of
  `TranslationKeyExists`' 907 were false**, audited key by key against a tolerant load of
  every en file. `app.activities.tables.item` is in `en/activities.yml`; it was reported as
  undefined because its file had been discarded.

  `TranslationProvider.loadYaml` and `getDefaultTranslations` now read with js-yaml's
  `json: true` — last value wins, which is what Ruby/Psych does at render time, so the linter
  agrees with what the instance serves. A file YAML cannot read AT ALL is still a value
  rather than an exception, which is what keeps one bad file from costing the editor every
  document link in a page.

  **`YAMLSyntaxError` (error, recommended)** is the counterpart to `LiquidHTMLSyntaxError`
  and, until now, the missing one: a YAML source drew no diagnostic however broken it was,
  while every reader quietly declined to use it. It reports each complaint the parser makes,
  positioned. It is deliberately type-agnostic, because a broken `app/config.yml` is the same
  bug as a broken translation file; `fixed-path-files.spec.ts` records it as the one YAML
  check that needs no file-type guard, and pins that a config file YAML reads cleanly still
  draws nothing.

  **Duplicate keys are NOT reported here.** `YAMLSyntaxError` answers one question — does this
  file parse — and it is on the MCP supervisor's write gate (`BLOCKING_CHECKS`), whose stated
  justification is that the converter rejects the changeset. Measured, the converter does the
  opposite: `pos-cli deploy --dry-run` ACCEPTS a repeated key and the platform resolves it
  last-wins, so the file deploys and renders. Reporting it at `error` from a blocking check
  made every one of those a false block — refusing to let an agent write a file the platform
  takes. Blocking legal, working input is this toolchain's most expensive failure mode.

  **`DuplicateYAMLKey` (warning, recommended)** carries that finding instead, off the gate:
  `blocksWrite` requires severity `error` AND membership of `BLOCKING_CHECKS`, and this check
  satisfies neither. WARNING rather than INFO because it is silent DATA LOSS — a translation
  string the author wrote never reaches a user and nothing else says so — and the precedent is
  `DuplicateRenderPartialArguments`, the same defect one level up, already a warning. The
  squiggle lands on the EARLIER entry, departing from that precedent deliberately: the later
  occurrence is the one that WINS, so highlighting it would point the author at the working
  value and invite them to delete it. The dead one gets the mark.

  Two things it does not report, both decided by measuring rather than by taste: a trailing
  `---` terminator, since Ruby reads such a file as one document plus an empty one and
  flagging it produced 88 offenses on one project for nothing; and an empty second document.
  A second document WITH content is reported — only the first is ever read, so the rest of
  the file is dead.

  A list value is now ONE key in both key-set walkers rather than one key per element. `t`
  returns the whole list and `{{ 'app.relationships.type' | t | parse_json }}` is how a
  project reads one, so `…type.0` is not a key anyone can add — and the two walkers no longer
  disagree about what a key is.

  Measured across four real projects: the largest went 9460 → 8830 offenses (−676 false
  `TranslationKeyExists`, −26 internal-error reports, +61 `MatchingTranslations` that were
  verified genuine, +11 duplicate keys, now `DuplicateYAMLKey` warnings rather than
  `YAMLSyntaxError` errors), two were unchanged, and `pos-module-community` +1 — a
  real duplicate in its own module translations. The most valuable single find is not a
  translation: one project's `app/config.yml` sets
  `graphql_argument_type_mismatch_mode: ignore` on line 10 and `: error` on line 123, so that
  instance has been running with `error` and the earlier setting was dead.

## 0.0.17

### Patch Changes

- Improved checks

## 0.0.16

### Patch Changes

- Additional checks and improvements

## 0.0.15

### Patch Changes

- Improved Liquid Linting
  - Better metadata params validation — Reworked detection of undefined variables in page/partial metadata parameters, reducing false positives
  - Improved undefined object detection — More accurate identification of undefined objects in Liquid templates
  - Fixed invalid property detection — The unknown-property check now correctly catches more cases of invalid property access on objects

## 0.0.14

### Patch Changes

- ctrl+click fix

## 0.0.13

### Patch Changes

- better ctrl click, more checks

## 0.0.12

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

## 0.0.11

### Patch Changes

- Beta release

## 0.0.10

### Patch Changes

- Beta release

## 0.0.9

### Patch Changes

- Beta release

## 0.0.8

### Patch Changes

- Beta release

## 0.0.7

### Patch Changes

- Update dependencies

## 0.0.6

### Patch Changes

- Beta release

## 0.0.5

### Patch Changes

- Beta release

## 0.0.4

### Patch Changes

- Beta release

## 0.0.3

### Patch Changes

- Beta release

## 0.0.2

### Patch Changes

- Beta release
