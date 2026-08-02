---
id: TASK-12.25
title: >-
  recursiveReadDirectory prunes by directory NAME instead of anchoring to the
  app subtrees
status: Done
assignee: []
created_date: '2026-08-01 09:46'
updated_date: '2026-08-01 19:07'
labels:
  - bug
  - check-common
  - platformos-graph
  - language-server
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while implementing TASK-12.22 (2026-08-01).

`context-utils.ts`'s `recursiveReadDirectory` skips any directory whose URI ENDS
WITH `.git`, `node_modules`, `dist`, `build`, `tmp` or `vendor`. The last four are
not safe: they match at any depth, including inside `app/`.

Measured over ~200 local projects in `~/projects/pos`, files under a directory with
one of those names classify as REAL app sources 262 times:

| segment | candidate files | classify as app sources |
|---|---|---|
| node_modules | 3674 | 0 |
| .git | 0 | 0 |
| dist | 0 | 0 |
| build | 6 | 6 (`Accala-MP/app/lib/commands/v2/projects/update/build/*.liquid`) |
| tmp | 126 | 123 (`pos-modules/pos-module-user/tmp/user/public/**`) |
| vendor | 133 | 133 (`htevent/app/views/pages/vendor/**` — an entire section of a live site) |

Two callers are affected, and both silently see a smaller project than
`pos-cli check` does:

- `platformos-graph/src/graph/build.ts` — htevent's ~200 `pages/vendor` pages are
  missing from the dependency graph, so every reference to them looks orphaned/broken.
- `platformos-language-server-common`'s `DocumentManager.preload` — the LSP does not
  manage those files.

`NON_SOURCE_DIRECTORIES` in `platformos-common` is now the measured-safe list
(`node_modules`, `.git`) and `ignoredFolders` derives from it plus the four unsafe
names, so the fix is to drop the extras — but that widens the walk on projects with a
large root-level `dist`/`build`/`vendor`, which is why it was not done inside
TASK-12.22. Measure the LSP preload and graph build before and after; if the walk cost
matters, prune those four only when they are ANCHORED at the project root, which is
where they actually mean build output.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 recursiveReadDirectory no longer skips app directories named vendor, build, tmp or dist
- [x] #2 A test pins that a page under app/views/pages/vendor is found by the graph build and by the LSP preload
- [x] #3 The walk cost on a project with a large root-level dist/build/vendor is measured before and after
- [x] #4 recursiveReadDirectory's callers walk APP_SOURCE_SUBTREES rather than skipping directories by name, and ignoredFolders is deleted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DONE — the blacklist is gone; both callers walk `APP_SOURCE_SUBTREES`

New `walkAppSourceFiles(fs, rootUri, filter?)` in `platformos-common`
(`src/app/walk.ts`): the one project walk over an `AbstractFileSystem`, anchored to
`APP_SOURCE_SUBTREES` the same way `getApp` was in TASK-12.22. The graph build and
the LSP preload now call it; `recursiveReadDirectory`, `isDirectory` and
`ignoredFolders` are deleted from `check-common`'s `context-utils`.

Two details worth keeping:

- **A missing subtree is discovered by listing its PARENT, not by probing it.**
  Every `AbstractFileSystem` reports a missing directory differently (`ENOENT`,
  VS Code's `FileNotFound`, the test double a bare `Error`), and most projects have
  no `marketplace_builder/` and no `modules/`, so "absent" cannot depend on error
  shape. A directory that IS listed and then fails to read still throws — an
  unreadable project must not lint as a smaller one.
- Each directory is listed at most once per walk: `modules/*/public` and
  `modules/*/private` expand through the same `modules/` and per-module listings.

### AC #3: measured, and it settles the description's open question

The description worried that widening the blacklist to the safe names would cost
walk time. Anchoring does not widen anything — it never OPENS those directories.
Synthetic worst case (2000 app files, 20 000 files under root-level
`dist`/`build`/`vendor`/`coverage`), warm:

| walk | time | finds `app/views/pages/vendor/index.liquid` |
|---|---|---|
| blacklist as it was | 19-23 ms | NO |
| blacklist shortened to `.git`/`node_modules` (the description's idea) | 63-69 ms | yes |
| anchored (landed) | 6 ms | yes |

Real projects, warm, `isSupportedSourceFile` filter, before → after:

| project | before | after | app files the blacklist MISSED |
|---|---|---|---|
| htevent | 23-24 ms | 24-28 ms | **137** (`app/graphql/vendor/**`, `app/views/pages/vendor/**`) |
| Accala-MP | 71-78 ms | 31-34 ms | 3 (`app/lib/commands/v2/projects/update/build/*`) |
| arabbank | 35-38 ms | 30-34 ms | 0 |
| pos-module-community | 20-21 ms | 18-19 ms | 0 |

The reverse direction too: the old walk collected `seed/post_import/**` (arabbank, 1
file) and `tests/post_import/**` (Accala-MP 2, pos-module-community 9), which the
platform does not deploy — the same finding as TASK-1.1, from the other side.

### Behaviour change to know about

The LSP no longer PRELOADS files outside the app subtrees, so its managed set now
matches the linter's app. Opening one still manages it — `open`/`change` gate on
`isSupportedSourceFile` and are untouched.

### Tests

- `platformos-common/src/app/walk.spec.ts` (7): subtree coverage including
  `app/views/pages/vendor` and `app/lib/commands/.../build`, nothing outside the
  subtrees (asserting WHICH directories are opened, not just the file list), filter
  applies to files only, one listing per directory, no app subtrees at all,
  unreadable directory throws, deleted-mid-walk directory tolerated.
- `platformos-graph/src/graph/build.spec.ts`: a page under `app/views/pages/vendor`
  is an entry point and its partial is a traversed node with a reference (AC #2).
- `platformos-language-server-common/src/documents/DocumentManager.spec.ts`:
  `preload` manages the `vendor`/`build`/`tmp` app files and nothing under
  `tmp/`, `node_modules/` or `dist/` (AC #2).

Monorepo `yarn test` 295 files / 2637 tests green, `yarn type-check` clean.
<!-- SECTION:NOTES:END -->
