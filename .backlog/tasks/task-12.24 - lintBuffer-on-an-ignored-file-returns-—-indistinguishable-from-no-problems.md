---
id: TASK-12.24
title: >-
  lintBuffer on an ignored file returns [] — indistinguishable from 'no
  problems'
status: Done
assignee: []
created_date: '2026-07-31 21:03'
updated_date: '2026-08-01 19:36'
labels:
  - check-node
  - mcp-supervisor
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by profiling (TASK-12.6 follow-up, 2026-07-31). Pre-existing behaviour, not a
regression — surfaced because it wasted profiling time looking for a bug that was not
there.

`getApp` drops files matching the project's `.platformos-check.yml` `ignore` list. So
`lintBuffer` on such a file finds no file to visit and returns `[]`.

Reproduced on pos-module-community, whose config ignores `modules/common-styling/**`:
linting `modules/common-styling/public/views/pages/style-guide.liquid` with a buffer
containing BOTH an unknown filter and a missing partial returns **zero offenses and
performs zero parses**.

For a human running `pos-cli check` that is fine — they wrote the ignore list. For
`validate_code`, an agent asked "is this file OK?" and was told, in effect, "yes". Those
are different answers and the caller cannot tell them apart.

## Options

1. `lintBuffer` reports that the file is excluded by configuration — a distinct result,
   not an offense. Cleanest for the agent-facing seam.
2. Lint it anyway when it is explicitly named, on the grounds that naming a file is a
   stronger signal than a glob. Risks contradicting `pos-cli check` on the same file.

(1) is preferred; the MCP supervisor's result contract has room for a status.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 lintBuffer distinguishes 'excluded by configuration' from 'no offenses found'
- [x] #2 A test pins the ignored-file case, so the silent-empty behaviour cannot come back
- [x] #3 pos-cli check's behaviour for the same file is unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DONE — and it was three silent cases, not one

`lintBuffer` returns `{ status, offenses }` instead of `Offense[]`. Option 1 from the
description: the exclusion is a distinct RESULT, not an offense and not an exception.
A discriminated status was chosen over a thrown error so a caller has to look at it to
type-check, rather than having to remember to catch.

Probing the real seam turned up two more paths that answered exactly like a clean
file. On pos-module-community, all with a buffer containing an unknown filter AND a
missing partial:

| path | before | now |
|---|---|---|
| `app/views/partials/testt.liquid` | 2 offenses | `checked`, 2 offenses |
| `modules/common-styling/…/style-guide.liquid` (config `ignore`) | **0 offenses** | `excluded-by-config` |
| `tests/post_import/app/views/partials/x.liquid` | **0 offenses** | `excluded-by-config` |
| `scripts/whatever.liquid` (outside every app subtree) | **0 offenses** | `not-an-app-file` |
| `app/assets/scripts.js` (an asset — no parser, no checks) | **0 offenses** | `not-a-source-file` |

`offenses` is empty for every status but `checked`, so the empty list keeps its one
honest meaning.

Detection, in order:

1. `excluded-by-config` — `isIgnored` in BOTH shapes, because `getApp` matches the
   patterns against the filesystem path and `check()` against the URI, and a file
   either one excludes is a file no check visits. Asked before `getApp`, so an
   excluded file no longer pays for a project walk either.
2. `not-an-app-file` — `App.setSource` returns `undefined`, i.e. `parseAppPath`
   places the path in no platformOS directory. Nothing was added, nothing to undo.
3. `not-a-source-file` — the file is classified but `type` is `undefined`, so no
   parser and no visitor: `check()` iterates the source types and never reaches it.

### AC #3 — `pos-cli check` is untouched

It goes through `appCheckRun`, which does not call this seam. Its treatment of an
ignored file (drop it) is unchanged.

### Callers

- `platformos-mcp-supervisor`: `runLint` returns `{ diagnostics, notChecked }`, and
  the handler puts the reason in `next_step` — "NOT VALIDATED: … an empty result here
  is not a clean bill of health". `ValidateCodeStatus` has no value for this yet;
  giving it one belongs to TASK-8.4, and is noted there rather than invented here.
  The `not-an-app-file` message lists the subtrees from `APP_SOURCE_SUBTREES` (now
  re-exported by check-node) rather than spelling them — the directory-knowledge
  guard in platformos-common catches exactly that, and did.
- Tests that are about offenses use a new `lintBufferOffenses` helper, which asserts
  `status === 'checked'` on the way through. So the existing suite now also pins that
  every file it lints is a file the seam really checked.

### Tests

`check-node/src/lint-buffer.spec.ts`, `says when it did not check the file` (5): one
per status against a workspace with an ignored module, a `scripts/` file and an
asset, plus one asserting an unchecked buffer leaves no trace in the shared app.
`supervisor/src/lint/lint.spec.ts` (2): the adapter carries `notChecked` up instead
of flattening it into an empty diagnostic list.

Monorepo `yarn test` 296 files / 2652 tests green, `yarn type-check` clean.
<!-- SECTION:NOTES:END -->
