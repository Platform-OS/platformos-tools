---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
'@platformos/platformos-check-browser': patch
'@platformos/platformos-graph': minor
'@platformos/platformos-language-server-common': minor
'@platformos/platformos-language-server-node': patch
'@platformos/platformos-mcp-supervisor': patch
---

Lazy `App` object model, one anchored project walk, and a `lintBuffer` that says
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
