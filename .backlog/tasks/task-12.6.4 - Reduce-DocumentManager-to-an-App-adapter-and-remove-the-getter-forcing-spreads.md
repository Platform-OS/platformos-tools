---
id: TASK-12.6.4
title: Reduce DocumentManager to an App adapter and remove the getter-forcing spreads
status: To Do
assignee: []
created_date: '2026-07-31 16:42'
labels:
  - language-server
  - architecture
  - performance
dependencies:
  - TASK-12.6.1
parent_task_id: TASK-12.6
priority: medium
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No source object is spread or Object.assign-ed anywhere in platformos-language-server-common — verified by an audit of the package, not just the four known sites
- [ ] #2 A test pins that constructing the LSP's view of a file does not force its parse, using a spied parser
- [ ] #3 DocumentManager holds an App and no longer maintains its own uri-to-sourcecode Map
- [ ] #4 version === undefined still means 'on disk', and app(root, includeFilesFromDisk) returns the same set it does today for open, on-disk, and mixed cases
- [ ] #5 open, change, changeFromDisk, close, delete and rename each leave the App in the state the equivalent DocumentManager operation produces today
- [ ] #6 First-diagnostic and first-completion latency after workspace open are measured before and after, and neither regresses
- [ ] #7 The full language-server test suite passes unchanged
<!-- AC:END -->
