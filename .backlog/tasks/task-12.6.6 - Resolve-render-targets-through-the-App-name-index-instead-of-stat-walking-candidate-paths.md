---
id: TASK-12.6.6
title: >-
  Resolve render targets through the App name index instead of stat-walking
  candidate paths
status: To Do
assignee: []
created_date: '2026-07-31 16:42'
labels:
  - performance
  - platformos-common
dependencies:
  - TASK-12.6.1
parent_task_id: TASK-12.6
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`DocumentsLocator.locate(rootUri, nodeType, fileName)` tries each candidate search path in order and returns the first that `stat()`s as a file. It is called **once per call site**, not once per distinct target, by five checks — `partial-call-arguments`, `missing-partial`, `graphql-variables`, `nested-graphql-query`, `unknown-property`.

Measured on a 1400-file project (400 partials, 8000 `{% render %}` sites): **~40,000 `stat` calls and ~9,000 `readFile` calls per whole-project run, for 400 distinct partials**. On this filesystem 8,000 stats ≈ 167 ms and 8,000 reads ≈ 539 ms, versus 35 ms for the 400 distinct reads — roughly 20× redundant I/O.

The `App` model makes this a lookup rather than a search: `AppFile#name` IS the logical `render` name (including the `modules/<name>/` prefix), and `App` keys a per-type `Map<name, AppFile>` on it. `locate` becomes `app.find(type, name)` — O(1), no I/O, and it already reflects module-overwrite shadowing, which the current path-order walk reproduces implicitly by trying app paths before module paths.

## Change

- Add the name-index resolution path to `DocumentsLocator` (or have checks take the `App` and drop the locator for resolution).
- Keep `list(rootUri, nodeType, filePrefix)` for completions — it enumerates directories and is a different job, though it can also read from the index instead of `readDirectory`.
- The current `locate` must stay available for the case where no `App` is in hand, OR every caller must be migrated. Decide which, and do not leave two resolution semantics that can disagree — that is the bug this whole epic is trying to stop reintroducing.

## Correctness note

The path-order walk and the index must agree on precedence. `getAppPaths`/`getModulePaths` order plus "first stat wins" currently encodes app-over-module precedence; the index encodes `app/modules/X` shadows `modules/X`. Prove these are the same rule with a test over a fixture containing an app-level partial, a module original, and a module overwrite of the same name — before deleting the walk.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Render-target resolution performs no stat or readFile when the App already holds the target — pinned with a counting AbstractFileSystem
- [ ] #2 A fixture with an app-level partial, a modules/X original and an app/modules/X overwrite of the same name resolves identically through the old path walk and the new index
- [ ] #3 Whole-project run stat and readFile counts are measured before and after on a multi-hundred-partial project and recorded
- [ ] #4 Either every locate caller is migrated, or the remaining stat-walk path is documented with why it cannot use the index — no two resolution rules that can silently disagree
- [ ] #5 Completions via list() still return the same sorted, de-duplicated names, including module-prefixed ones
<!-- AC:END -->
