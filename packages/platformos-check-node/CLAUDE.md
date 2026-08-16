# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@platformos/platformos-check-node` is the Node.js runtime for the platformOS
linting engine. It wires the runtime-agnostic core
([`@platformos/platformos-check-common`](../platformos-check-common)) to the
filesystem (`NodeFileSystem`, glob-based project discovery), config resolution,
the docset (`@platformos/platformos-check-docs-updater`), the CLI, and autofix.
All check/detection logic lives in `-common`; this package is the I/O shell.

## Commands

```bash
yarn build        # tsc -b tsconfig.build.json, then postbuild: generate-factory-configs
yarn type-check   # tsc --noEmit
yarn test         # vitest

# Single spec
yarn test src/index.spec.ts
```

## Entrypoints (`src/index.ts`)

| Function | Use |
|---|---|
| `check(root, configPath?)` | Lint a whole project on disk → `Offense[]`. |
| `appCheckRun(root, configPath?, log?)` | As `check`, plus the resolved `App` + `Config`. |
| `checkAndAutofix(root, configPath?)` | Lint then write safe autofixes to disk. |
| `lintBuffer({ root, filePath, content, configPath?, log? })` | Lint ONE in-memory buffer in the context of its on-disk project (cross-file checks resolve against real files; the buffer is overlaid in memory). Returns `{ status, offenses, ast? }` — the buffer file's `Offense[]` with `fix`/`suggest` intact, whether the file was checked at all (`checked` / `excluded-by-config` / `misplaced-source` / `not-a-platformos-file` / `not-a-source-file`), because an empty list otherwise reads as "no problems" for a file nothing looked at, and the parsed Liquid tree of the content that was CHECKED. The typed seam for embedders (e.g. the MCP supervisor) — a direct library call, **no LSP, no subprocess, no message-string round-trip**. See README. |
| `getApp(config)` / `getAppAndConfig(root, configPath?)` | The lazy `App` model for the project (walked and reconciled — **no reads, no parses**) and the resolved config. |
| `getPlatformOSDocset()` | **THE** `AugmentedPlatformOSDocset` for this process — the same object the lint reads from. For an embedder answering a question about the VOCABULARY (a filter's signature, a tag's parameters) rather than about a file. |

`appCheckRun` and `lintBuffer` both delegate to the private `lintApp(app, config,
log, only?)` helper, which serves `getDocDefinition` from the passed `app`
(`doc-definitions.ts`) — this is what lets `lintBuffer`'s overlaid buffer be
cross-referenced with its UNSAVED `{% doc %}` params rather than the stale
on-disk version. `lintBuffer` passes `only: [uri]` so just that file is
*visited*, while the whole `app` stays visible to cross-file checks.

### `ignore` gates REPORTING, never the `App`

An ignored file is an ordinary part of the app: it defines routes, partials and
translations, and every other file resolves against it. `ignore` means one thing —
no offenses are reported ON it — and check-common's `check()` applies it per file per
check. **Do not filter `getAppFilePaths` (or any `App`) by it.** Doing so made an
ignored file invisible to cross-file checks, and the false positives then landed on
files the config does *not* ignore: a project ignoring its vendored `modules/*` got
`No page found for route '/inbox'` because the page defining `/inbox` lives in one.
`index.spec.ts`'s "files the config ignores are still visible to cross-file checks"
group fails if this comes back.

### `{% doc %}` for a target outside the app (`doc-definitions.ts`)

`getDocDefinition` falls back to reading and parsing a render target the app does not
contain — one outside the walked subtrees, or one that appeared after this run's walk —
memoized per run exactly like the targets it does. `DocumentsLocator` resolves those by
`stat`ing candidate paths, so a check can be handed a file the index never saw; with no
contract, `PartialCallArguments` infers the parameter list from the source and reports
an OPTIONAL param as a missing required argument. Built with `nodeParsers`, so a parse
is a parse however the file was reached.

### The lazy `App` model

`getApp` serves `@platformos/platformos-common`'s `App`: it globs, reconciles, and
reads nothing. Files read their source on the first `load()` and parse on the first
`ast`, so a single-file lint pays for the file it visits plus the render targets that
file resolves — measured at 6 liquid parses on a 3138-file project, where the old
eager `getApp` parsed all of them on every call (15.3 s → 0.27 s; warm `lintBuffer`
15.3 s → 0.24 s; RSS peak 1174 → 431 MB).

`nodeParsers` (exported) is the one place in this runtime that knows how a file
becomes an AST — liquid, graphql and yaml. There is deliberately **no JSON parser**:
JSON is served from `.json.liquid`, so a `.json` file is an asset, not a source.

**This package does not classify project files.** `getAppFilePaths` produces
CANDIDATES and `App.fromPaths` decides which of them the app contains. Do not add a
`getFileType`-style filter back: it was measured to be pure duplication (identical
app on four real projects, file by file).

The walk is ANCHORED, not blacklisted, and it is `platformos-common`'s
`walkAppSourceFiles` — the same one the graph build and the language server's preload
use. It recurses `readdir` over one subtree per `APP_SOURCE_SUBTREES` entry (`app/`,
`marketplace_builder/`, `modules/*/public`, `modules/*/private`) keeping
`SOURCE_FILE_EXTENSIONS` — both from `platformos-common`. That is `parseAppPath`'s own
grammar as a prefix, so the walk cannot disagree with the classifier, and it never sees
`node_modules` at all. It replaced a `glob` of the equivalent patterns: same paths file
for file on four real projects, 9-15% faster (median 39 → 33 ms on the largest, 33 →
28 on another), because it filters by extension as it enumerates. This package exports
no glob patterns any more: `getAppFilesPathPattern` was kept for "consumers that need
PATTERNS, i.e. file watchers" and there are none — not pos-cli, whose watcher hands
chokidar directories and a predicate. Build them from `APP_SOURCE_SUBTREES` and
`SOURCE_FILE_GLOB` in `platformos-common` if you ever need them.

An unreadable directory now FAILS the run instead of being skipped the way `glob` did:
a lint that silently covers less of the project than it claims is the failure mode this
whole area keeps producing. It fails as `platformos-common`'s `UnreadableDirectoryError`,
which explains itself, and `cli.ts` prints that message and exits 1 rather than letting
an unhandled rejection print a `scandir` stack. Any OTHER error still shows its stack —
that one is a bug, not a project problem. Hidden entries (`.#card.liquid`,
`._card.liquid`, `.old/`) are skipped, as they were under `glob`'s `dot: false`.
Do not "improve" this by walking the whole tree and skipping directories by NAME:
`app/views/pages/vendor/**` is a real section of a real site that any `vendor`
blacklist loses, and `tmp/app/views/partials/x.liquid` is not a partial no matter what
its directory is called. Walk cost, whole-tree vs anchored, on two real projects:
903 → 33 ms and 177 → 30 ms.

Two consequences to keep in mind when editing this package:

- **Never `await file.load()` at map time.** `doc-definitions.ts` awaits it INSIDE
  each memo body; hoisting it would load the whole project and undo the model.
- **`lintBuffer` overlays with a version** (`app.setSource(uri, content, 0)`) and
  reverts it in a `finally`. A version is what marks a file an unsaved buffer for the
  code that prefers buffer content over disk — translations, and the route table's own
  route. The app now outlives the call, so the overlay must not: one request's unsaved
  content is not the next request's truth.
- **Anything derived from the buffer must be captured INSIDE that `finally`'s `try`.**
  `LintBufferResult.ast` is, and that is why it is returned rather than looked up: after
  the call the `App` holds DISK content, so an AST read then describes different text than
  the offenses do — correct on every unchanged file and wrong on exactly the edited ones,
  which is the worst shape a bug can have. It is present only for a LiquidHtml buffer that
  PARSED (an unparseable file's `ast` is an `Error` VALUE, not a throw), so "present" means
  "these offenses and this tree share coordinates". `index.spec.ts`'s "returns the AST of
  what was checked" group fails if the capture moves.

### Process-level state

All lint runs share one `PlatformOSLiquidDocsManager` (every loader on it is a
per-instance memo, including a network revision check).
`resetPlatformOSLiquidDocsManager()` discards it; `updateDocs` calls that for
you.

They also share ONE `AugmentedPlatformOSDocset` over it, built beside the manager and
discarded with it, and `lintApp` passes THAT to `check()`. `check()` only wraps a docset
that is not already augmented (it tests `isAugmented`), so the checks read the same object
`getPlatformOSDocset()` returns — one alias expansion, one set of memos, instead of a
fresh wrapper per run.

**An embedder must reach the docset through `getPlatformOSDocset()`, never by
constructing a manager of its own.** A second `PlatformOSLiquidDocsManager` re-pays every
memo, makes another network revision check, and can settle on different data — so a tool
explaining an offense could describe a filter the check that flagged it never saw. That
accessor exists so no consumer needs `platformos-check-docs-updater` as a dependency; the
MCP supervisor has a guard failing its build if that dependency or import returns.

They share one `App` per project (`src/shared-app.ts`), reconciled per call rather
than rebuilt. **The walk is not cached** — the candidate paths are globbed on every
call, because a process with no filesystem events (an agent editing files out of
band) has no other way to learn what changed. What is reused is everything the walk
does not tell you: classification, both indexes, and whatever sources and ASTs the
previous calls lazily loaded. Reconciliation is therefore three rules, in
`getSharedApp`:

- files the walk no longer sees are dropped, files it did not know are added;
- files whose source is IN MEMORY are `stat`ed and dropped if their `mtime`/`size`
  moved — that is the handful a single-file lint touched, not the project. The
  baseline is established at this REVALIDATION, not by the read (a `stat` before
  every read cost +25% on whole-project commands for a comparison a one-shot
  process never makes), so a file's first revalidation always drops it: one
  conservative re-read per file, once. The baseline is recorded before the re-read
  that follows it, so a write racing that read still fails the next comparison —
  revalidation can re-read a file that did not need it, never trust one that did;
- files carrying an unsaved buffer are left alone by both rules.

Retention is capped (`MAX_RETAINED_FILES`) and evicts in `AppFile.lastTouch` order —
every `load()` (cache hits included) and `ast` read counts as use — so the files
that go are the ones no recent call consulted, not the earliest-read ones, which
were precisely the render targets an agent's validate-loop keeps coming back to.

`resetSharedApp()` discards it. Compare URIs as STRINGS in this path: both sides are
already normalized, and asking `App.has()` per path re-parses every URI in the project
on every call (20-40 ms on a 3139-file app).

They also share one `RouteTable` per project (`src/route-table.ts`), because
`MissingPage` needs every page's frontmatter — whole-project I/O that lazy parsing
cannot touch. It is reconciled per run against each page's `mtime`/`size`, so an
unchanged project costs zero page reads while an added, changed or deleted page is
still reflected without a rebuild. `resetRouteTable()` discards it. Both caches
compare `mtime`/`size` through the one `fingerprintOf`/`UNKNOWN` pair in
`src/fingerprints.ts` — they share the sentinel, so they must share the comparison.

`lintApp` passes it as a PROVIDER (`routeTable: () => getSharedRouteTable(...)`), not
as a table. Reconciling costs a `stat` per page — 389 on a real project — and only
`MissingPage`, on a file that actually links somewhere, consumes it: 87-97% of the
Liquid in a real project contains no `<a href>`/`<form action>` whose URL survives
`shouldSkipUrl`, so resolving it up front was whole-project I/O for nothing. Do not
"simplify" this back to an awaited table. The provider is called at most once per run,
and while `lintBuffer`'s overlay is still in place, which is what lets an unsaved
page's own frontmatter define its own route.

## Factory configs (`configs/*.yml`)

`configs/all.yml`, `recommended.yml`, and `nothing.yml` are **generated** by
`scripts/generate-factory-configs` (run automatically as the build's
`postbuild:ts`) from check-common's `allChecks` / `recommended`. They are
committed. **After adding or removing a check in check-common, rebuild this
package (`yarn build`) and commit the regenerated configs** — `all.yml` and
`recommended.yml` enumerate every check; `nothing.yml` only carries
`extends`/`ignore` and does not change per-check.

## Cross-platform paths

Filesystem paths from `glob()` / `path.join()` / `os.tmpdir()` must be normalized
to forward slashes with `platformos-common`'s `toPosixPath` before
regex/minimatch/glob use, and converted with its `uriFromPath` when they must
become a URI — never `URI.file(p).toString()`, whose `file:///c%3A/…` matches no
URI this runtime produces. This package no longer depends on `normalize-path`:
`toPosixPath` is the same normalization, owned by the package every other one
already depends on. URIs use the `path` helpers from check-common (vscode-uri
based), never `toPosixPath` (which throws rather than collapse `file:///`). See
the monorepo root `CLAUDE.md`.

## Tests

Vitest. `src/test/test-helpers.ts` provides `makeTempWorkspace(tree)` (writes a
real temp project, returns `{ rootUri, uri(), clean() }`) and config/mock-module
helpers. Hermetic check tests use a `.platformos-check.yml` with
`extends: platformos-check:nothing` plus the specific check enabled, avoiding
docset/network dependencies.
