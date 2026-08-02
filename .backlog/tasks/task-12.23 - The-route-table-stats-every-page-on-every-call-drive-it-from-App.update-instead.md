---
id: TASK-12.23
title: >-
  The route table stats every page on every call; drive it from App.update
  instead
status: Done
assignee: []
created_date: '2026-07-31 21:02'
updated_date: '2026-08-01 17:55'
labels:
  - performance
  - check-node
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured while profiling TASK-12.6 (2026-07-31). The process-level `RouteTable`
(TASK-12.6.7) removed the per-call page READS, but it still fingerprints every page
with a `stat` on every call:

| Project | pages | warm `lintBuffer` reads | warm `lintBuffer` stats |
|---|---|---|---|
| pos-module-community | 118 | 2 | **117** |
| arabbank | 390 | 10 | **389** |

One stat per page per call — ~20 ms on arabbank. Correct, but redundant: the `App` is
rebuilt from a fresh glob on every call anyway, and TASK-12.6.7's own notes say the
natural wiring is for `App.update(uris)` to drive `routeTable.updateFile`, since the App
already holds that page's source.

Blocked on TASK-12.19 (reuse one App per process): with a per-call App there is nothing
to diff against, so the stat sweep is currently the only way to detect a changed page.
Do these together.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A warm lint performs zero page stats for an unchanged project, measured against the 117 / 389 baseline here
- [x] #2 A page added, changed or deleted on disk between calls is still reflected, pinned by a test (TASK-12.6.7 AC #3 stays true)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-01. AC #1 is met for the case that matters and is NOT achievable in
the case it was written for — read on, the wording matters.

## The premise had rotted, in the opposite direction to TASK-12.25's

"Redundant: the `App` is rebuilt from a fresh glob on every call anyway" was true when
this was written and stopped being true with TASK-12.19. The App now reads nothing and
`stat`s only the handful of files whose source is in memory, so the page sweep is not
duplicating anything — after 12.19 it became the ONLY thing in a warm lint that knows
whether a page changed. `App.update(uris)` cannot drive `routeTable.updateFile` for a
page nobody loaded, because the App has no content for it and no reason to get any.

So "zero page stats while still reflecting a changed page" is not a wiring problem, it
is unachievable as stated:

- A page's route comes from its frontmatter (or, absent a `slug`, from its path). An
  edit that moves a `slug` changes no directory mtime and is invisible to the walk, so
  ADDED and DELETED pages are free (the walk sees them) but CHANGED ones cost a `stat`
  each. There is no cheaper honest signal.
- A directory-mtime probe cannot see a content edit at all. A filesystem watcher could,
  and is the standard answer for a long-lived process, but it buys inotify limits, WSL
  and network-mount behaviour, and a CLI that does not need one — for ~10 ms.

What IS redundant is doing it at all. `MissingPage` is the only consumer of the table,
and it only needs one when the file under it links somewhere internal:

| project | .liquid files | with `<a href>`/`<form action>` |
|---|---|---|
| arabbank | 2735 | 311 (11%) |
| pos-module-community | 1303 | 172 (13%) |
| Accala-MP | 2287 | 77 (3%) |

check-node resolved the table before `check()` even started, so 87-97% of single-file
lints paid whole-project page I/O to answer a question nobody asked.

## What landed

- `Dependencies.routeTable` accepts `RouteTable | (() => Promise<RouteTable>)`;
  `makeGetRouteTable` asks a provider rather than building from it, since the provider
  owns making its own table current. The LSP's instance path is unchanged.
- `MissingPage` awaits `context.getRouteTable()` at the first URL that survives
  `shouldSkipUrl`, not in `onCodePathStart`. `context.getRouteTable` is memoized per
  run, so a file with 30 links still resolves once.
- `lintApp` passes `() => getSharedRouteTable(config.rootUri, app)`. The call lands
  inside `lintBuffer`'s overlay window, so an unsaved page still defines its own route.

## Measured, warm, three runs each (after the cold call)

| project | file | before | after |
|---|---|---|---|
| arabbank | `pages/about-us.liquid` (no internal links) | 71-79 ms, **405** stats | 63-65 ms, **16** stats |
| arabbank | `partials/async-operation.liquid` | — | 54-77 ms, **8** stats |
| pos-module-community | `partials/testt.liquid` | — | 47-64 ms, **8** stats |
| Accala-MP | `partials/invoices/index_csv.liquid` | — | 75-86 ms, **8** stats |
| arabbank | `theme/simple/contacts/index.liquid` (resolves routes) | — | 117-118 ms, 461 stats |

The 8 remaining stats are the shared App revalidating what it has in memory; none is a
page. The phase this removes, measured before the change: 8.5-11.9 ms and 389 stats warm
on arabbank, 2.2-3.9 ms and 117 stats on pos-module-community, and 138 ms plus 390 page
READS cold. A file that does resolve a route pays exactly what it paid before — that is
the honest limit of this change.

## Equivalence

Whole-project `appCheckRun` dumps before vs after, every field of every offense
(check, severity, uri, message, start, end, fix, suggest count): arabbank 9623,
Accala-MP 256, pos-module-community 43 — **identical as sets**.

The offense ARRAY ORDER differs, and it was never stable to begin with: `check()` runs
every (file × check) pipeline concurrently into one shared array, so order follows I/O
completion. Two runs of the UNCHANGED binary on pos-module-community already differ (18
lines); Accala-MP happened to match. Nothing downstream sorts or depends on it.

Suites: 2623 tests, 293 files, all green; monorepo type-check and build clean. New
pins: three in `missing-page/index.spec.ts` (provider untouched when a file links
nowhere; untouched when every URL is skipped; asked exactly once for a file with
several links) and two in check-node's `route-table.spec.ts` (a link-free lint performs
zero page reads AND zero page stats on the FIRST call; skipping the build does not stop
a later call from doing it, including reporting a real `MissingPage`).
<!-- SECTION:NOTES:END -->
