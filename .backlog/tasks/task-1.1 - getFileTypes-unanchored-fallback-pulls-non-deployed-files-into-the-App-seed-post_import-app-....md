---
id: TASK-1.1
title: >-
  getFileType's unanchored fallback pulls non-deployed files into the App
  (seed/post_import/app/...)
status: Done
assignee: []
created_date: '2026-07-31 21:03'
updated_date: '2026-08-01 09:04'
labels:
  - platformos-common
  - correctness
dependencies: []
parent_task_id: TASK-1
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by profiling arabbank (TASK-12.6 follow-up, 2026-07-31).

Of 3140 files in the App, one is outside `app/`, `modules/` and `marketplace_builder/`:

    seed/post_import/app/migrations/20220517145452_index_rebuild.liquid

It is linted as a Migration. It is not deployed — it is seed data that happens to
contain an `app/migrations/` path segment.

## Why it gets in

`getFileType` matches a known directory ANYWHERE in the URI (`/app/migrations/`), not
anchored at the project root. `App.createAppFile` classifies with the anchored
`parseAppPath` FIRST and falls back to `getFileType`, deliberately, so that the set of
files an App contains stayed exactly what the pre-existing glob produced. The anchored
parse gets this right and would exclude it; the fallback is what keeps it.

## Decision needed

Dropping the fallback makes classification strictly anchored and fixes this — but it
CHANGES THE LINTED FILE SET, which is why TASK-12.6.1 kept it. It needs a deliberate
call plus a check of what else it would drop across real projects, not a quiet change.

Worth doing together with TASK-1 (mirroring the backend's FULL_PHYSICAL_PATH regexps),
since that is where the anchoring rules get settled.

Note the same file is why `AppFile#name` has a fallback branch: a file classified only
by `getFileType` has no logical name, so its whole relative path stands in.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 It is decided whether classification should be strictly anchored at the project root, with the rationale recorded
- [ ] #2 The file count and file set for pos-module-community and arabbank are compared before and after any change, so nothing is silently dropped
- [ ] #3 If the fallback stays, the over-inclusion is documented where createAppFile makes the choice
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done — classification is now strictly anchored.

`createAppFile` no longer falls back to `getFileType`. A file belongs to the app only
if `parseAppPath` anchors it at `{app,marketplace_builder}/{dir}/…` or
`[app/]modules/<name>/{public,private}/{dir}/…` relative to the root. Matching a known
directory ANYWHERE in the path is not enough — that is all `getFileType` can do, having
no root to anchor against.

`seed/post_import/app/migrations/20220517145452_index_rebuild.liquid` is gone from
arabbank's app: 3140 → 3139 files, Migration 72 → 71.

`AppFile#name` lost its fallback branch with it: every AppFile is anchored now, so
`pathToName` always resolves.

## Verified on both real projects

| | files | outside app\|modules | inside node_modules | suspect (seed/vendor/tmp/dist/generators) |
|---|---|---|---|---|
| pos-module-community | 946 | 0 | 0 | 0 |
| arabbank | 3139 | 0 | 0 | 0 |

Top-level roots contributing files are exactly `app/…` and `modules/<name>/…` on both.

Note arabbank uses `app/model_schemas` in earnest, so the legacy Table aliases are load
bearing and were kept — only their ORDER changed, so `schema` is canonical.
<!-- SECTION:NOTES:END -->
