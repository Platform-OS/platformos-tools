---
id: TASK-12.6.4
title: Reduce DocumentManager to an App adapter and remove the getter-forcing spreads
status: Done
assignee: []
created_date: '2026-07-31 16:42'
updated_date: '2026-08-02 17:10'
labels:
  - language-server
  - architecture
  - performance
dependencies:
  - TASK-12.6.1
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`DocumentManager` is the closest thing the TS side has to the Ruby App model — it owns versions, open/change/close/delete/rename and rename tracking — but it is a second, LSP-shaped implementation with its own `Map<UriString, AugmentedSourceCode>`, and its `preload` reads and eagerly parses every file in the workspace. Once 12.6.1 lands it should hold an `App` and delegate, keeping only what is genuinely LSP-specific.

## The blocker this task exists to fix

`augmentedSourceCode` spreads the source object in **all four** type branches:

```ts
case SourceCodeType.JSON:
  return { ...sourceCode, textDocument };
```

Spreading evaluates getters. So the moment `ast` becomes a lazy getter, `{...sourceCode}` forces the parse for every file — silently defeating the laziness. This is precisely why option 2 in TASK-12.6 was rated "buys less than it appears to". It is a fixable bug, and fixing it is a precondition for the model being worth anything in the LSP.

Replace the spread with composition: keep the `AppFile` as a field (or attach `textDocument`/`getLiquidDoc` to the instance) rather than copying it into a new object literal. Any other `{...sourceCode}` / `Object.assign` over a source object in this package must be found and given the same treatment — audit, do not assume these four are the only ones.

## Mapping

| DocumentManager today | With the model |
|---|---|
| `sourceCodes: Map<uri, AugmentedSourceCode>` | the `App`'s `byUri` |
| `open`/`change` | `setSource(uri, source, version)` |
| `changeFromDisk` | `invalidate(uri)` — let the lazy read do the work |
| `close` | `setSource(source, undefined)` |
| `delete` / `rename` | `App.remove` / `remove` + `update` |
| `preload` (reads + parses all) | `App.fromPaths` + await `load()` only where needed |
| `app(root, includeFilesFromDisk)` | `App` query with the same version filter |

`version === undefined` meaning "on disk" and `versioned`-vs-open filtering must be preserved exactly — several LSP features depend on it.

## Care needed

`preload` being eager is not purely waste here the way it is in check-node: the LSP wants warm ASTs for cross-file features, and it is `memoize`d per `rootUri` so it happens once per session. Do NOT make LSP responsiveness worse in the name of laziness — measure first-completion and first-diagnostic latency before and after, and consider keeping a background warm-up that awaits `load()` across the app without blocking startup.

## Two more things now depend on this (added 2026-08-02)

**1. `set()` is the last place in the toolchain that cannot classify.** TASK-3.1 made
classification anchored everywhere: `getFileType` and every predicate now REQUIRE a
`rootUri`, because a platformOS file is one whose position relative to the project root
matches the directory structure. Every consumer was given a root — checks through
`context.fileType()`, the graph through `AppGraph.rootUri`, the LSP's file-event
handlers and rename handlers through `findAppRootURI`, `app(root)` and
`preload(rootUri)` through their own parameters.

`DocumentManager.set(uri, source, version)` could not be, and the reason is structural:
**this class holds no root.** It is fed bare URIs by `open`/`change`/`close`/`rename`
and only ever learns a root as a PARAMETER of `app()` and `preload()`. So `set` now
gates on `sourceCodeTypeOf(uri) !== undefined` — "can we parse this", which a URI
answers alone — and the app-membership question is asked in `app(root)`, which is what
`runChecks` goes through, so diagnostics are anchored.

That split is honest but it is a split. When this class holds an `App`, it holds a
root, and `set` can answer both questions in one place. Until then a file outside the
app that the user OPENS is still managed (not diagnosed — `app(root)` filters it out).

**2. The graph and the lint still parse the same file twice.** `platformos-graph`
exports `appBackedGetSourceCode(app, fallback)` and `graphParsers` precisely so a
process that builds a graph AND runs checks holds one set of `AppFile`s. The language
server is that process — `AppGraphManager` + `runChecks` over the same project — and it
is the only one today. It cannot use them: `AppGraphManager.graphDependencies()` builds
`getSourceCode` from `documentManager.get()` plus a `toSourceCode` fallback, because
`DocumentManager` has `AugmentedSourceCode`s and no `App` behind them. Wiring
`appBackedGetSourceCode` in is part of finishing this task, and it is what makes
TASK-12.6.5's mechanism actually pay. (The MCP supervisor becomes the second consumer
once TASK-7.6 gives its lint adapter a graph.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No source object is spread or Object.assign-ed anywhere in platformos-language-server-common — verified by an audit of the package, not just the four known sites
- [x] #2 A test pins that constructing the LSP's view of a file does not force its parse, using a spied parser
- [x] #3 DocumentManager holds an App and no longer maintains its own uri-to-sourcecode Map
- [x] #4 version === undefined still means 'on disk', and app(root, includeFilesFromDisk) returns the same set it does today for open, on-disk, and mixed cases
- [x] #5 open, change, changeFromDisk, close, delete and rename each leave the App in the state the equivalent DocumentManager operation produces today
- [x] #6 First-diagnostic and first-completion latency after workspace open are measured before and after, and neither regresses
- [x] #7 The full language-server test suite passes unchanged
- [x] #8 set() classifies with a root like every other consumer, rather than gating on sourceCodeTypeOf alone — the App it holds supplies one
- [x] #9 AppGraphManager builds its getSourceCode with appBackedGetSourceCode(app, fallback), so a graph build and a lint run over the same project share one parse per file
- [x] #10 A file outside the app that the user opens is managed only as far as the editor needs (no diagnostics, no graph node), and a test pins it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DONE

`DocumentManager` is now an adapter over `platformos-common`'s `App`, one per project
root, and no longer keeps a `Map<UriString, AugmentedSourceCode>` of its own.

### What it holds

| Before | Now |
|---|---|
| `sourceCodes: Map<uri, AugmentedSourceCode>` | `apps: Map<rootUri, App>` + `unrooted: Map<uri, AugmentedSourceCode>` |
| `set` → `toSourceCode` (reads AND parses) | `App.setSource` (parses on the first `ast`) |
| `preload` reads and parses every file | walk → `App.update` (classification only) → read the parseable ones; parse nothing |
| `app(root)` = three filters over every entry | `App.sourceCodes()`, filtered by version |
| `delete`/`rename` = map operations | `App.remove` / `remove` + `setSource` |

`unrooted` is not the old map under a new name: it holds only buffers that belong to
NO app — a `.liquid` file opened from outside a project, `scripts/build.liquid`, and a
buffer whose root nobody has named yet. `appAt` adopts the last of those into the app
the moment a root IS named, which is what makes the `didOpen`-before-`findAppRootURI`
ordering safe.

### AC #8 — `set()` classifies with a root

It asks two questions now: `sourceCodeTypeOf` ("can we parse it", from the URI alone)
and then `App.setSource`, which returns `undefined` when the path is not one the
platform deploys RELATIVE TO THE ROOT the app supplies. That is the same question
`getFileType`, the checks and the graph ask, asked once. A readable file the platform
does not deploy is still an editor document (AC #10) and is in no `App`, so it gets no
diagnostics and no graph node.

### AC #9 — one parse per file for the graph and the checks

`AppGraphManager.graphDependencies(rootUri)` builds its `getSourceCode` with
`appBackedGetSourceCode(documentManager.appModel(rootUri), fallback)`, and the App is
built with `languageServerParsers` = check-common's `sourceParsers` + the graph's
`.js`/image entries. So the graph and the checks hold the SAME `AppFile` instances —
pinned by identity with a spied parser, not inferred.

`sourceParsers` is new in check-common; check-node's `nodeParsers` is now an alias for
it rather than a second spelling of the same three lines.

### The invariant that made this safe, and the bug that found it

`App.update` classifies every path the walk found BEFORE `preload` reads any of them,
and `AppFile.source` throws rather than pretending to be `''`. So a file can be IN the
app and have no contents — which the old `Map` could never represent, because it only
got an entry after the read returned. `get()`/`app()`/`openDocuments` therefore expose
a file only when `type !== undefined && loaded`, restoring exactly the old set.

Getting that wrong was silent. `runChecks` resolves a partial's `{% doc %}` through
`documentManager.get()`, so a file answering before it was read cost every
`PartialCallArguments` diagnostic on the opened page. It only showed up in the
end-to-end measurement (5 diagnostics → 0), never in a unit test, which is why AC #6's
harness earned its place.

The same measurement exposed a second, pre-existing race: `runChecks` never waited for
`preload`, and only got away with it because preload took 17 s and monopolised the
event loop, so the first check could not run until it was over. Now that preload is
fast, `runChecks` awaits it (memoized per root, so this is free after the first call).

### AC #6 — measured, over the real language server

Driven through `startServer` on a JSON-RPC pair — `initialize` → `didOpen` → the first
`publishDiagnostics` for that file, then a `textDocument/completion` round trip — on
`arabbank` (2735 liquid files), five runs each, medians:

| | before | after |
|---|---|---|
| first diagnostic | 17,742 ms | **771 ms** |
| first completion | 191 ms | 187 ms |
| warm completion | 129 ms | 126 ms |
| RSS after those | 705-720 MB | **333-347 MB** |
| diagnostics published | 5 | 5 (identical) |

Neither regresses; the first diagnostic is 23x faster because opening a workspace no
longer parses it.

**The one cost that moved, stated rather than hidden.** A whole-project graph build now
pays for the parses preload used to: `appGraph/dependencies` went from 198 ms to
11.5 s on arabbank. It is a one-time cost — the ASTs stay on the `AppFile`s, so the
next graph request is 1 ms — and the total is still lower (18.0 s to a graph before,
12.4 s after), but it lands on the first graph consumer instead of on startup. That is
the right trade: most sessions never build a graph, and the ones that do were paying
the same parses at open. A background warm-up would put it back on startup and undo
what this epic removed, so it is deliberately not there.

### Tests

`documents/app-adapter.spec.ts`, 20 cases: preload parses nothing; a parse error stays
a captured `Error`; `version === undefined` still means "on disk" and
`app(root, includeFilesFromDisk)` returns the same sets; each of open/change/
changeFromDisk/close/delete/rename against the App it leaves behind (including a module
overwrite whose deletion promotes the original back); a file the platform does not
deploy stays an editor document and out of the app; a buffer opened before its root is
named joins the app; the graph and the checks get the identical file object and one
parse. Plus the two invariant pins above. The existing `lazy-composition.spec.ts` audit
(no source object spread anywhere in the package) and all 482 pre-existing tests pass
unchanged — 502 in the package, 2726 in the monorepo.
<!-- SECTION:NOTES:END -->
