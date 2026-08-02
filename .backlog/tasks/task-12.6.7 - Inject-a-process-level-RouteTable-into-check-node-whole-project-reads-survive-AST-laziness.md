---
id: TASK-12.6.7
title: >-
  Inject a process-level RouteTable into check-node (whole-project reads survive
  AST laziness)
status: Done
assignee: []
created_date: '2026-07-31 16:54'
updated_date: '2026-07-31 18:11'
labels:
  - performance
  - check-node
dependencies: []
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`MissingPage` is `recommended: true` and depends on `getRouteTable`. `RouteTable.build()` calls `discoverPageFiles` and then `fs.readFile` on **every page** to read its frontmatter (slug/method/format) — measured **~170 ms and ~1000 `readFile` calls** on a 1400-file project.

This is whole-project **I/O, not liquid ASTs**, so TASK-12.6's lazy parsing does nothing for it. Without this task, 12.6.3 cannot reach its <500 ms target: parses go away and this stays.

## The fix is already half-built

`makeGetRouteTable(fs, rootUri, injectedDependencies.routeTable)` (`check-common/src/context-utils.ts`) accepts an existing table and only builds when `!table.isBuilt()`. The language server already passes a persistent one (`startServer.ts`). **check-node passes nothing**, so every `lintApp` call constructs a fresh `RouteTable` and rebuilds it from disk.

Hold one at process level next to `sharedDocsManager`, with the same lifetime and reset story (TASK-12.4 established the pattern and the reasoning about a long-lived process pinning stale state).

## Invalidation

`RouteTable` already exposes `updateFile(uri, content)` / `removeFile(uri)` / `buildFromEntries(entries)`, so incremental update is available and a full rebuild is not needed when a page changes. Once the App model (12.6.1) lands, the natural wiring is: `App.update(uris)` for a page also drives `routeTable.updateFile`, since the App already holds that page's source. Prefer that over a timer.

For a buffer being validated before it is written, the edited page's own route must reflect the UNSAVED content — check whether `lintBuffer`'s overlay currently affects the route table at all (it likely does not, since the table reads from `fs`), and pin the behaviour either way.

## Watch for

Do not simply reuse one table across different `rootUri` values — it is per project. Key it by root, or reset it when the root changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A second lint run in the same process performs zero page readFile calls for an unchanged project — pinned with a counting AbstractFileSystem
- [ ] #2 MissingPage diagnostics are identical before and after, including for module pages and pages with explicit frontmatter slug/method/format
- [ ] #3 A page added, changed, or deleted on disk is reflected in MissingPage results without a full rebuild
- [ ] #4 An unsaved buffer's own route is resolved from the buffer content, not the on-disk version — or, if that is deliberately out of scope, the current behaviour is pinned by a test and documented
- [ ] #5 Switching rootUri within one process does not serve routes from the previous project's table
- [ ] #6 Route-table read counts and per-call latency are recorded alongside 12.6.3's numbers so the two contributions are separable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implemented in `packages/platformos-check-node/src/route-table.ts`

One `RouteTable` per process, keyed by `rootUri`, reconciled against the `App` on
every `lintApp`. `resetRouteTable()` and `warmRouteTable(rootUri)` are exported —
the latter is for servers that want routes ready before the first request rather than
on it.

## Invalidation: fingerprints, not a timer and not a rebuild

`FileStat` gained an optional `mtimeMs` (`NodeFileSystem` fills it; an in-memory or
virtual fs leaves it undefined, which is read as "cannot tell whether this changed",
never as "unchanged"). Per page the table records `mtimeMs:size`.

- first call for a project: read every page and `buildFromEntries` — the data has to
  come from somewhere.
- later calls: `stat` each page (~389 stats ≈ 20 ms on a 390-page project) and
  `updateFile` only those whose fingerprint moved.
- pages gone from the app: `removeFile`.

`mtime` is part of the fingerprint deliberately — a same-length frontmatter edit
(`slug: about` → `slug: elsewh`) defeats a size-only check, and there is a test for
exactly that.

## The unsaved buffer resolves its OWN route from the buffer

A page carrying an in-memory buffer (`version !== undefined`) is registered from the
buffer's content and fingerprinted as `unknown`, so it is never trusted across calls.
That makes "validate a page before writing it" resolve links to the page's new slug —
previously impossible, since the table only ever read from `fs`.

## Acceptance criteria

- #1 ✔ a second `lintBuffer` in the same process performs ZERO page reads on an
  unchanged project (counting `NodeFileSystem.readFile`); the cold call reads every
  page except the buffer, whose content it was handed.
- #2 ✔ identical `MissingPage` results warm vs cold vs freshly-reset, over a fixture
  with explicit `slug`/`format` frontmatter, a `.json.liquid` page and a module page.
- #3 ✔ pages added, deleted and re-slugged on disk are each reflected without a
  rebuild; the "added" test asserts only the NEW page was read.
- #4 ✔ implemented rather than deferred (see above) and pinned.
- #5 ✔ switching `rootUri` within one process discards the previous project's table —
  pinned with two temp workspaces where `/about` exists only in the first.
- #6 ✔ recorded on TASK-12.6.3 alongside the latency numbers, separably: the route
  table is 389 stats ≈ 20 ms of the 251 ms warm call; the glob is 226 ms of it.
<!-- SECTION:NOTES:END -->
