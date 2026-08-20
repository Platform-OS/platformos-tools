# @platformos/theme-check-node

## 1.0.0

### Major Changes

- f15573d: **BREAKING**: `InvalidHashAssignTarget` is renamed to `InvalidWriteTarget`. A
  `.platformos-check.yml` that configures it by the old name must be updated; the CLI reports
  an unknown check otherwise.

  The old name described one of the five constructs the check judges. Its subject is a write
  that goes INTO a container — a subscript write or an append — and three tags spell one:

  ```liquid
  {% assign      x['k'] = v   %}   {% assign   x << v   %}
  {% hash_assign x['k'] = v   %}   {% function x << 'p' %}
  {% function    x['k'] = 'p' %}
  ```

  `{% function x['k'] = 'p' %}` is newly judged. Its silence was documented as "the write
  semantics are unmeasured — it needs a partial that exists, and the oracle instance has
  none", which was wrong: measured against `/api/app_builder/liquid_exec` with the container
  read back, it obeys the rule identically to the other two spellings, error text included.

  | container                                               | `x['k'] = …`                                             | `x[0] = …`         |
  | ------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
  | Hash                                                    | writes                                                   | writes (key `"0"`) |
  | Array                                                   | raises _"x is an Array, expected index, k was provided"_ | writes             |
  | String / Number / Boolean / Range / Date / Time / unset | raises _"x is …, expected Hash or Array"_                | same               |

  Also measured and now covered: `date`, `time` and `range` targets for `<<`, and
  `{% function x.k = 'p' %}`, which writes the key `k` exactly as `{% assign %}` does.

  The messages no longer name the tag, because the rule is the write's and not the tag's —
  `assign expects a Hash or an Array` was a false statement about `assign`:

  - `Cannot write into 'x', which is a number. A subscript write needs a Hash or an Array.`
  - `Cannot write into 'x' with a string key, because it is an Array. Use a numeric index instead.`
  - `Cannot use '<<' on 'x', which is a Hash. '<<' appends to an Array.`

  An append offense no longer highlights the whitespace before the closing `%}`.

  Separately, `LiquidHTMLSyntaxError` now reports a `hash_assign` with no subscript at all.
  `{% hash_assign h = 'v' %}` parses in this repository — the markup rule is a
  `liquidVariableLookup`, which matches a plain name — and raises `Liquid::SyntaxError` on the
  platform whatever the target holds, so a Hash target was a silent false approval on a
  blocking check. It shares the dot form's message, since both have the same repair: rename
  the tag to `{% assign %}`, which accepts every target `hash_assign` refuses.

### Minor Changes

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

- a8f4da9: `lintBuffers` says whether it checked the file, and the supervisor turns that into advice an
  author can act on.

  An empty `Offense[]` means "no problems found" only when something looked. For a path the
  config excludes, an asset, or a file outside every deployed subtree it means "never
  examined", and the two are indistinguishable at the call site. `lintBuffer`/`lintBuffers` now
  return `{ status, offenses }` with a five-value `LintBufferStatus`: `checked`,
  `excluded-by-config`, `misplaced-source`, `not-a-platformos-file`, `not-a-source-file`.

  The two out-of-app cases are split HERE, where classification happens, so an embedder never
  re-derives the distinction from a raw path — and it matters because the remedies are
  opposite. A `.liquid` outside every deployed subtree is a platformOS source the platform will
  never load: dead code, and the author needs to hear that. A `.jsx` component in `src/` is a
  file that was never meant to be platformOS code, and telling its author to "move it under
  `app/`" is wrong advice. The supervisor maps these to `misplaced_source` and
  `unsupported_type` through one total table, so a status added upstream fails the BUILD at the
  point where someone has to decide what the agent should hear, rather than falling into a
  catch-all and reporting a plausible wrong reason.

  Neither blocks a write. A misplaced source is very likely a mistake, but "likely" is a guess
  about intent — a fixture or a generator template lives there legitimately — and a gate that
  vetoes legitimate work on a guess gets switched off.

  **An asset is never judged, decided by TYPE rather than by whether a parser accepts the
  extension.** The gate asks `platformos-common`'s `isParsedFileType`, so it and the lint
  cannot disagree about a path — see the separate changeset for the rule and the false block
  it closes.

  Also: `fingerprintOf` and `isKnownFingerprint` are exported for an embedder running its own
  never-stale cache over the same project. The sentinel itself stays private — it equals
  itself, so a cache that STORES it for an unreadable file would compare equal on the next scan
  and call the file unchanged forever.

- c0907ab: New check `RollbackOutsideTransaction` (error, recommended): report a `{% rollback %}` that is
  reached outside a `{% transaction %}` block.

  `Liquify::Tags::RollbackTag` raises `rollback performed outside of transaction` unless
  `AfterCommitEverywhere.in_transaction?`, so this is a guaranteed runtime error rather than a
  smell. The parser, the printer and the syntax highlighting already carried the tag; what was
  missing was anyone judging where it may appear.

  **It cannot be judged one file at a time.** A partial does not know its own transaction state —
  the identical `app/lib/order/place.liquid` is correct under `{% transaction %}{% function _ =
'order/place' %}{% endtransaction %}` and broken under a bare call. So a partial's own rollback
  is never reported where it is written; the check descends `render` / `include` /
  `theme_render_rc` / `function` / `background` call trees from the files whose entry state IS
  known, and reports at the CALL SITE, naming the chain: `Rendering 'wrapper' reaches a
{% rollback %} that is not inside a {% transaction %} block (wrapper → inner).`

  Which files have a known entry state is a `Record<PlatformOSFileType, …>`, so a new file type
  cannot be added without an answer, and three Liquid types are deliberate silences rather than
  oversights:

  | type                              | entry state      | why                                                                                                                                                                                                                |
  | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Page, Layout, Email, ApiCall, Sms | no transaction   | `PagesController#show` opens none; notifications render in `NotificationWorker`, never inline                                                                                                                      |
  | Migration                         | IN a transaction | `DataMigration#execute_queries` wraps the whole render in `AfterCommitEverywhere.in_transaction`, so a bare rollback there is CORRECT                                                                              |
  | Partial                           | unknown          | its caller decides — the reason the check descends at all                                                                                                                                                          |
  | FormConfiguration, Authorization  | unknown          | `Commands::FormSubmitViaMutation` submits a form programmatically, so `{% transaction %}{% graphql _ = 'submit' %}{% endtransaction %}` runs a form's callbacks, and its policies, INSIDE the caller's transaction |

  Two tags are barriers rather than wrappers. `{% background %}` takes its body back OUT of a
  transaction — the `{% transaction %}` documentation says a job scheduled inside one "will only
  be added to the queue after successfully committing the transaction", and
  `BackgroundTagWorker#perform` renders it with no transaction of its own — so a rollback under
  one is reported from ANY file, including a partial, and a `{% background x = 'p' %}` call never
  inherits its scheduler's transaction. `{% content_for %}` is a barrier to unknown: its body runs
  where the matching `{% yield %}` is, which may be another file, so its lexical position proves
  nothing and nothing inside it is reported.

  Not in `BLOCKING_CHECKS`. Deploy accepts the file, and unlike `MissingPartial` the finding rests
  on an inference across files with real gaps — a partial named by a variable, a `{% yield %}`, a
  form callback's entry state — so gating writes on it would promise more than the analysis
  supports.

  Measured on real projects. Twelve Liquid files across `~/projects/pos` contain a rollback and
  none is misplaced, so the whole-project runs report nothing — which on its own proves nothing,
  so the silence was controlled: `Accala-MP`'s `app/views/pages/api/v2/companies/update.json.liquid`
  calls `commands/v2/companies/update_disciplines`, whose two rollbacks sit inside its own
  `{% transaction %}`, and the descent reaches them and stays quiet; commenting that one
  `transaction` out in memory produces exactly one offense, on the page, naming the command. Cost
  is below run-to-run noise at both seams — whole project on `clearchoice` (4,000 Liquid files),
  3 runs each: 39.9s with, 39.8s without; single buffer through `lintBuffer`, warm median: 178ms
  vs 179ms. The per-file walk is memoized against the parse via `AppFile.derived`, so a partial on
  ten call sites is analysed once per run and the descent adds no parses a whole-project run was
  not already doing.

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

- cf80cfa: A render target the app does not contain now supplies its `{% doc %}` to the checks
  that read it.

  `ignore` says which files are REPORTED on. It must not change what is KNOWN about a
  file something else references — a partial's `{% doc %}` is its contract whether or
  not the partial is itself linted. `lintApp` built `getDocDefinition` from the app,
  and the app has the user's `ignore` applied, so a `{% render %}` into an ignored
  module resolved to a real file with no contract. `PartialCallArguments` then fell
  through to inferring the parameter list from that file's source, where a `{{ class }}`
  used without `| default` looks required — and an OPTIONAL `[class]` param became a
  missing required argument at every call site. `MissingRenderPartialArguments`,
  `UnrecognizedRenderPartialArguments` and `ValidRenderPartialArgumentTypes` went the
  other way and skipped those call sites entirely. The language server never had either
  problem, because `DocumentManager.preload` does not apply `ignore`.

  `getDocDefinition` now falls back to reading and parsing a target the app does not
  contain, memoized per run exactly like the targets it does — and only for a target
  some check actually resolved, so nothing is read to build the map. The file is not
  added to the app: it is still not reported on.

  On a real project (which ignores eleven modules and renders from them),
  `pos-cli check` goes from 43 offenses to 31: 17 false "Required parameter class /
  value" disappear, and 5 real ones appear that the type and argument checks had been
  skipping — including two the module author had already worked around with a
  `platformos-check-disable` comment. check-node and the language server now report the
  same offenses for that project, file for file.

- cf80cfa: Report `{% doc %}` drift on the partial that can fix it, not on the call site.

  A `{% doc %}` block is a declared contract and is treated as the source of truth: what it
  says is required IS required at every call site. The corollary is that when the doc and the
  implementation disagree, the defect is in the PARTIAL, and the diagnostic belongs there.
  `UnusedDocParam` already covered one direction of that drift. Two checks complete it.

  **`RequiredDocParamWithDefault` (warning, auto-fixable)** — a parameter the doc declares as
  required that the partial then reads through `| default`. Supplying the default is evidence
  the author handled the missing value, so the declaration almost certainly meant `[param]`.
  `modules/common-styling/forms/upload.liquid` on `pos-module-community` is the case that
  prompted this: its doc declares eight parameters, none bracketed, and its body opens with
  `assign image_editor_enabled = image_editor_enabled | default: false`. Two callers omit that
  argument and each got `Missing required argument`, on files that cannot fix the doc. One
  warning now lands on the partial, and the fix — bracketing the name in place, leaving type
  and description untouched — clears the call-site errors everywhere at once. It is safe to
  apply unattended, since making a parameter optional only widens what a caller may omit. The
  alternative, teaching the call-site check to believe the source over the doc, was tried and
  reverted: it treats the symptom and leaves the doc wrong for hover, completion and
  `backfill-docs`.

  **`MissingDocParam` (error)** — a variable the partial reads from its caller and does not
  declare. The mirror of `UnusedDocParam`, and not a cosmetic omission: the call-site checks
  read the doc as the complete parameter list, so an undeclared input is simultaneously
  required by the implementation and impossible to pass — `UnrecognizedRenderPartialArguments`
  reports it as an unknown argument at every call site that tries. Reported once per variable,
  at its first read, with a suggestion that inserts the declaration after the last existing
  `@param`. No type is emitted with it: nothing at a READ says what a caller should pass, and
  a guessed `{string}` would be a claim `ValidDocParamTypes` and the type checks then act on.

  Both run on partials only, and only where the doc declares at least one `@param` — a doc
  holding only an `@description` declares no contract, and `PartialCallArguments` owns those
  partials by inferring the parameter list from the source. Objects in scope inside every
  partial (`context`, `app`, …) are never reported.

  `UndefinedObject` cedes the undeclared inputs of a documented partial to `MissingDocParam`,
  so nothing is reported twice. The split is by definition, not by file: a name nothing in the
  file defines is an input the caller was meant to pass, and `MissingDocParam` owns it; a name
  the file DOES define and reads out of that definition's reach — a `for` variable after its
  loop, a value read before its `assign` — is a scope error no `@param` would fix, and stays
  with `UndefinedObject`. The two conditions are complements, so every name still draws exactly
  one report: measured on `platformos-blog` and `project-e`, the single
  `Unknown object 'data' used.` warning on `modules/user/public/lib/queries/api_call.liquid`
  became the single `MissingDocParam` error on the same read — a partial that forwards
  `data: data` to a GraphQL call while declaring only `api_template` and `timeout`, so no
  caller can supply it.

  Both checks share the per-file analysis the call-site checks already run, which now also
  reports which names the file defines and which of the optional ones it defaults ITSELF. That
  last distinction is what keeps a `| default` FALLBACK source out of
  `RequiredDocParamWithDefault`: in `assign profile = profile | default: params.profile` it is
  `profile` the partial handles the absence of, while `params` is only what it falls back on.
  The analysis is memoized on `(source, in-scope names)` and now takes the parse its caller
  already holds, so between the two checks a documented partial costs one walk and no parse.

  Measured on real projects. `RequiredDocParamWithDefault`: 122 offenses over 56 files on
  `platformos-blog`, 111 over 48 on `project-e`, 17 over 7 on `pos-module-community` with its
  vendored modules unignored — every one a doc backfilled as required over a body that
  defaults it, each with the safe fix. `MissingDocParam`: 1 offense on each of
  `platformos-blog` and `project-e`, 0 on `pos-module-community` and on three client
  projects, and the one it finds is a real defect.

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

- a8f4da9: Two filter checks, both derived from a live instance rather than from the documentation.

  **`FilterArity` (error, recommended)** reports a filter called with too few or too many
  arguments. The arity table is GENERATED (`scripts/verify-filter-arity.mjs`) against a running
  instance and committed, because the counting rule is not what it looks like and an off-by-one
  turns every correct call into an offense:

  ```
  {{ 'abc'    | upcase: a: 1, b: 2, c: 3 }}   -> 2 arguments  (input + ONE hash)
  {{ 'abc'    | upcase: 1, 2 }}               -> 3 arguments  (input + 2 positional)
  {{ 'abcdef' | slice: 1, 2, extra: 9 }}      -> 4 arguments  (input + 2 + one hash)
  ```

  The piped value is argument one, and a whole group of named arguments arrives as a single
  trailing hash however many names it contains.

  **`FilterWithoutEffect` (warning, recommended)** reports a filter in a platformOS tag's
  operand or argument value — where the platform parses it and then never applies it.

  This one is a warning specifically because it cannot be derived from the grammar, and the
  two available wrong answers fail in opposite directions. `pos-cli deploy --dry-run` ACCEPTS
  such a filter, so reporting it as an error would be an unappealable false block on a file
  that deploys. But the runtime never applies it: Ruby Liquid parses those markups with its own
  scanner, and `TagAttributes` captures `QuotedFragment`, which explicitly excludes `|`. The
  filter is dead code, so silence would let an author ship a file that does something other
  than what it says. Measured against `/api/app_builder/liquid_exec` across 15 positions and
  three independent lenses, each paired with a filterless control that renders clean.

  Both tables are regenerated by committed scripts and must be byte-identical when regenerated
  against an unchanged instance. The general rule they encode: where this toolchain and the
  platform implement the same thing independently, run the differential rather than reasoning
  about the spec.

- cf80cfa: A missing argument at an `{% include %}` site is a warning about explicitness, not an error —
  and no call-site offense names a tag the author did not write.

  `{% include %}` runs the partial in the CALLER'S scope. A variable the target reads and the
  call does not pass is therefore not missing: it resolves from the caller, and nothing is
  broken. `PartialCallArguments` reported it as `Required parameter X must be passed to render
call` at `Severity.ERROR`, which is wrong twice over — the claim, and the tag name.

  **`ImplicitIncludeArguments` (warning)** takes over that direction. It says what is actually
  true: `Partial 'x' reads 'order', which the include does not pass — it resolves from the
caller's scope. Pass it explicitly.` A separate code rather than a softened severity, because
  severity is per check and per-check overridable, so a team that uses `include` deliberately
  can turn the explicitness rule off without losing the real `render` errors. The suggestion
  inserts `, order: order`, which hands over the same value the partial was reading from the
  caller anyway. The platform-supplied names are included, not exempted — `content_for_layout`
  in a layout, `forloop` inside a caller's `{% for %}` are exactly the inherited-scope reliance
  the warning exists to surface, and each can be passed explicitly.

  Documented targets keep the ERROR. `MissingRenderPartialArguments` still reports a missing
  required `@param` at an include site, because a `{% doc %}` block is a declared contract and
  the ecosystem already honours it there — the `can_do_or_*` helpers in `pos-module-community`
  are included with every documented param passed explicitly, down to `entity: null`. Only the
  INFERRED path warns, since inference cannot tell a deliberately scope-sharing helper from a
  partial that wanted an argument. The unknown-ARGUMENT direction is unchanged too: passing
  something the target never reads is a real mistake whichever tag was used.

  `include` is not deprecated, and this is not a step towards removing it. The live docset marks
  no tag deprecated and describes `include` as what to reach for "when the partial must run in
  the caller's scope"; `{% break %}` crosses an include boundary and stops at a render one,
  which is why the `can_do_or_unauthorized` / `can_do_or_redirect` authorization helpers work at
  all. Converting those call sites to `render` would silently keep rendering a page after a
  denied check.

  **Wording, everywhere.** `{% render %}`, `{% include %}` and `{% theme_render_rc %}` all parse
  to the same `RenderMarkup` node, so a check that words its message from the node type names a
  tag that may not be in the file. `callSiteTag` reads the enclosing `LiquidTag` instead — the
  tag's own name is the answer — and all four call-site checks now use it:
  `PartialCallArguments`, `MissingRenderPartialArguments`,
  `UnrecognizedRenderPartialArguments` and `DuplicateRenderPartialArguments`, including the
  `with … as` alias branch of the third. `theme_render_rc` was being called "render" too, and
  now names itself. Since every one of those tag names is also a `DocumentType`, the same answer
  resolves the target as well as wording the message.

  Measured on the project where the two false ERRORs were found: a layout's
  `content_for_layout` (in scope in a layout) and a partial's `forloop` (in scope inside the
  caller's loop) are now warnings, while the true positives on a partial reading
  `{{ forloop.index }}` outside any loop of its own — so its output is always empty — still
  report as `PartialCallArguments` errors at the two `render` sites that omit it. The `role`
  argument that same include passes and its target never reads stays an error too, now worded
  `Unknown parameter role passed to include call`.

  Project-wide the split is 6270 errors + 1231 warnings against 7491 errors before, and 1221 of
  the 1231 warnings are the same findings under a new code. The other 10 are findings the old
  check never reached: `extractUndefinedVariables` throws on a `{% function %}` tag whose markup
  the parser left unstructured, and the throw aborts the rest of that file for the check, so a
  syntax error in one partial costs offenses in every file that calls it.
  `ImplicitIncludeArguments` reaches those sites because it returns before analyzing anything at
  a non-`include` call site. That crash is pre-existing and is filed separately — fixing two
  occurrences of it recovered 156 offenses, and left this check's 1231 warnings untouched in
  both runs. Nothing here depends on it.

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

- 4b6e0aa: Add ReservedVariableName check: using a reserved Liquid literal (`true`, `false`, `nil`, `null`, `empty`, `blank`) as a variable name is now an error. Liquid resolves these names as built-in literals before variable lookup, so assignments to them can never be read back. Covers assign, capture, function, graphql, parse_json, hash_assign, for, tablerow, background, increment, decrement, and catch targets. UnusedAssign no longer reports these names to avoid a misleading "assigned but not used" message. The reserved-name set is derived from `LiquidLiteralValues`, now exported from `@platformos/liquid-html-parser`.
- Updated dependencies [a8f4da9]
- Updated dependencies [a8f4da9]
- Updated dependencies [cf80cfa]
- Updated dependencies [8f1beea]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [e3a7fb0]
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
  - @platformos/platformos-common@0.1.0
  - @platformos/platformos-check-common@1.0.0
  - @platformos/platformos-check-docs-updater@1.0.0
  - @platformos/liquid-html-parser@0.1.0

## 0.0.19

### Patch Changes

- Improved checks
- Updated dependencies
  - @platformos/platformos-check-docs-updater@0.0.19
  - @platformos/platformos-check-common@0.0.19

## 0.0.18

### Patch Changes

- Additional checks and improvements
- Updated dependencies
  - @platformos/platformos-check-common@0.0.18
  - @platformos/platformos-check-docs-updater@0.0.18

## 0.0.17

### Patch Changes

- Updated dependencies
  - @platformos/platformos-check-common@0.0.17
  - @platformos/platformos-check-docs-updater@0.0.17

## 0.0.16

### Patch Changes

- Improved Liquid Linting
  - Better metadata params validation — Reworked detection of undefined variables in page/partial metadata parameters, reducing false positives
  - Improved undefined object detection — More accurate identification of undefined objects in Liquid templates
  - Fixed invalid property detection — The unknown-property check now correctly catches more cases of invalid property access on objects

- Updated dependencies
  - @platformos/platformos-check-common@0.0.16
  - @platformos/platformos-check-docs-updater@0.0.16

## 0.0.15

### Patch Changes

- ctrl+click fix
- Updated dependencies
  - @platformos/platformos-check-common@0.0.15
  - @platformos/platformos-check-docs-updater@0.0.15

## 0.0.14

### Patch Changes

- better ctrl click, more checks
- Updated dependencies
  - @platformos/platformos-check-common@0.0.14
  - @platformos/platformos-check-docs-updater@0.0.14

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
