---
id: TASK-12.3
title: Let check() lint a single requested file without losing cross-file diagnostics
status: Done
assignee: []
created_date: '2026-07-29 03:52'
updated_date: '2026-07-29 04:38'
labels:
  - performance
  - check-common
  - check-node
dependencies: []
modified_files:
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-check-common/src/check-only.spec.ts
  - packages/platformos-check-common/src/test/test-helper.ts
  - packages/platformos-check-node/src/index.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`lintBuffer` runs every enabled check over every project file and then discards all offenses except the edited file's. On pos-module-mcp that is 21 s of work to produce a 93 ms answer.

This is safe to scope down because of an invariant in the engine: `check()` has exactly one `offenses.push` (`platformos-check-common/src/index.ts`), and it hardcodes `uri: file.uri`. An offense therefore always belongs to the file being visited — no check can report against a different file. Skipping other files' pipelines produces exactly the set `lintBuffer` already computes by filtering afterwards.

The subtlety is *where* to scope. `check()` builds cross-file dependencies (`getDefaultTranslations`, `getTranslationsForBase`, `getRouteTable`, `fileExists`) from the full `app`, and cross-file checks (`MissingPartial`, `OrphanedPartial`, `TranslationKeyExists`, …) resolve the rest of the project through those dependencies and through `context.fs`. So the whole `app` must still be passed in; only the set of files whose check pipelines get enqueued may be narrowed.

Add an opt-in option to `check()` naming the file(s) to visit, thread it through `lintBuffer`, and leave every existing caller (CLI, autofix, language server) on today's whole-project behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `check()` accepts an optional, documented way to restrict which files are visited, defaulting to today's behaviour when omitted
- [x] #2 Cross-file dependencies are still constructed from the complete app, so cross-file checks resolve the rest of the project unchanged
- [x] #3 `lintBuffer` returns byte-identical offenses for the buffer's file with the restriction applied versus without it, asserted by a test over a project exercising cross-file checks (MissingPartial, OrphanedPartial, TranslationKeyExists)
- [x] #4 Whole-project consumers (`check`, `checkAndAutofix`, CLI, language server) are unaffected — no signature change at their call sites
- [x] #5 A test pins the invariant this relies on: an offense's uri is always the visited file's uri
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`check()` takes an optional fourth argument, `CheckOptions { only?: UriString[] }`, and each `SourceCodeType` branch now enqueues pipelines only for the named files (`filesToVisit`). Omitting it is exactly today's whole-project behaviour, so the four existing callers (`test-helper`, LSP `runChecks.ts`, `check-browser`, `check-node`) are untouched. `lintBuffer` passes `only: [uri]` and keeps its post-filter as an explicit statement of its contract.

The complete `app` is still handed to `check()`, so the cross-file dependencies built from it (`getDefaultTranslations`, `getTranslationsForBase`, `getRouteTable`, `fileExists`) are unchanged and cross-file checks still resolve the whole project. Confirmed the disabled-checks module is consistent under scoping: `isDisabled` keys strictly on `offense.uri`, and the per-file disable ranges are populated from visited files only, so a file's own `platformos-check-disable` comments still apply and no other file's can leak in.

Verified in the wild, not just in unit tests: a script compared `lintBuffer` against `appCheckRun`'s whole-project offenses filtered to the same uri — dna-idea all 87 files (21 with offenses), pos-module-mcp 25 files, poetry-blog 25 files (101 with offenses). 0 mismatches on every field including fix/suggest presence and ranges.

Measured: `check()` time for one buffer on pos-module-mcp 21350 ms → 81 ms.
<!-- SECTION:FINAL_SUMMARY:END -->
