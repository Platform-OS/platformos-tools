---
id: TASK-12.6.8
title: >-
  Introduce a singleFileOnly check partition (Ruby's single_file guard), default
  on
status: To Do
assignee: []
created_date: '2026-07-31 16:56'
updated_date: '2026-07-31 16:57'
labels:
  - architecture
  - check-common
  - language-server
dependencies: []
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port the Ruby `single_file` guard so laziness becomes STRUCTURAL rather than something every dependency has to be careful about. Reference: `~/projects/lsp/platformos-check/lib/platformos_check/{check,checks,analyzer,liquid_visitor}.rb` and `language_server/{configuration,handler,diagnostics_manager}.rb`.

`singleFileOnly` defaults to TRUE. The LSP and `validate_code` use the default; `pos-cli check` (whole-project run through platformos-check-node) sets it to false.

## Two orthogonal axes — do not conflate them

| Axis | Controls | Status |
|---|---|---|
| `CheckOptions.only: UriString[]` | which files are VISITED | landed (TASK-12.3) |
| `CheckOptions.singleFileOnly: boolean` | which CHECKS run | this task |

`lintBuffer` = `only: [uri]` + `singleFileOnly: true`. `pos-cli check` = no `only` + `singleFileOnly: false`. They compose; neither subsumes the other.

## Ruby mechanism being ported

- `Check.single_file` is a class-level declaration whose **default is derived**: `!method_defined?(:on_end)` — a check is single-file unless it defines the whole-app aggregation hook.
- `Checks#single_file` / `#whole_platformos_app` partition the set (memoized).
- `Analyzer#analyze_files(files, only_single_file:)`: when true, run ONLY single-file checks and ONLY on `files`; when false, additionally run whole-app checks over the whole app.
- `Checks#single_file_end_dependencies(app_file)` — in single-file mode the visitor ALSO visits the handful of extra files a check declares it needs. This is Ruby's explicit version of "a couple more files"; in TS the same files are reached implicitly and lazily via `getDocDefinition` / `PartialCallArguments` (~9 on a 1400-file project), so an explicit declaration is probably unnecessary — but decide that deliberately rather than by omission.

## The Ruby default heuristic does NOT map — classification must be explicit

TS has no whole-app aggregation hook: `onCodePathEnd(file)` is per-FILE, so `!method_defined?(:on_end)` would classify every check as single-file. Add an explicit `meta.singleFile?: boolean` (defaulting to true) and audit every check in `allChecks`.

TS also has a third category Ruby did not really face, because it is where the cost actually lives:

1. **Pure single-file** — needs only the visited file's AST. Trivially single-file.
2. **Single-file report, whole-project DATA** — reports on a node in the edited file but resolves against the project: `MissingPage` (route table), `MissingPartial` (stat), `TranslationKeyExists` (translations), `PartialCallArguments` (render targets), `MissingAsset`.
3. **Whole-app aggregation** — needs "what does the rest of the project say about me": `OrphanedPartial` (`is any file referencing this partial?`).

**Category 2 stays in the single-file set.** `MissingPage` in particular is explicitly wanted in the LSP and in `validate_code` — it is a genuine per-file diagnostic. Its whole-project cost is solved by caching the data (12.6.7 persistent `RouteTable`, 12.6.1's path index), NOT by dropping the check. `singleFileOnly` is about the SCOPE OF REPORTING, not a license to skip expensive checks.

**Category 3 is what the flag actually excludes.** `OrphanedPartial` is the only current member and is the one check that genuinely needs the whole project PARSED. Note it is already inert in check-node today (`getReferences` is wired only in the LSP's `runChecks.ts`), so `validate_code` silently omits it — this task should make that a declared consequence of `singleFileOnly` rather than an accident of unwired dependencies.

Re-audit `MatchingTranslations` deliberately: it compares translation files against each other, so whether it is category 2 or 3 depends on whether it reports on the edited translation file or across the set.

## Hazard: stale diagnostics in the LSP

The LSP's `diagnostics/runChecks.ts` deliberately lints the WHOLE app because it must clear stale diagnostics per file — if a run only reports on one file, previously-published diagnostics for other files must not be silently dropped or left stale. Ruby hit exactly this and solved it in `language_server/diagnostics_manager.rb` (`build_diagnostics(..., only_single_file:)` keeps other paths' diagnostics and only updates the analyzed ones, plus `clear_diagnostics` on close). Port that logic together with the flag — turning on `singleFileOnly` in the LSP without it will make diagnostics for other files disappear or go stale.

## This gives TASK-12.5's `mode` a real meaning

`mode: quick` = `singleFileOnly: true`, `full` = `false`. That is strictly better than 12.5's option 3 (lint the buffer without loading the project at all), which was rejected because it hides `MissingPartial`/`MissingPage` and makes a pre-write gate worse. Here `quick` keeps every per-file diagnostic and drops only whole-app aggregation. Record the decision on 12.5 if this lands; note that `quick` should then be the DEFAULT for a pre-write gate, which inverts today's `full`-by-default.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CheckOptions.singleFileOnly defaults to true and filters the check set, independently of CheckOptions.only
- [ ] #2 Every check in allChecks carries an explicit single-file/whole-app classification, and a test asserts the partition covers the whole set with no unclassified check
- [ ] #3 MissingPage, MissingPartial, MissingAsset, TranslationKeyExists and PartialCallArguments all still run and report under singleFileOnly: true
- [ ] #4 OrphanedPartial does not run under singleFileOnly: true, and this is asserted rather than incidental to getReferences being unwired
- [ ] #5 pos-cli check runs with singleFileOnly: false and its offenses are unchanged from today over a real multi-hundred-file project
- [ ] #6 The LSP under singleFileOnly does not drop or leave stale the diagnostics it previously published for other files — covered by a test that edits file A after B had offenses
- [ ] #7 A single-file run performs no whole-project parse — pinned with a spied parser asserting parse count stays at the visited file plus its lazily-reached render targets
- [ ] #8 MatchingTranslations is classified with a recorded rationale
- [ ] #9 The removal of OrphanedPartial from editor diagnostics is documented in the check's docs and the changelog as a deliberate trade, with pos-cli check named as where it still runs
- [ ] #10 getReferences is no longer wired into the LSP's runChecks dependencies, so no graph is built for a check that cannot consume it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Decision: OrphanedPartial is whole-app — pos-cli check only, NOT the LSP

### Why it is category 3, and MissingPartial is not

The two checks ask opposite questions, and only one of them needs parsing:

| Check | Question | Needs | Cost |
|---|---|---|---|
| `MissingPartial` | FORWARD: does `render 'foo'` resolve to a file? | the path index | O(1), **zero parsing** |
| `OrphanedPartial` | REVERSE: does any other file render ME? | every file's render/include/function edges | **whole-project parse** |

"Does a partial with this name exist" is free once 12.6.1's `App` has classified the paths — no file content is needed at all. But the reverse direction cannot be answered without having parsed every liquid file to extract its outgoing references. That, not existence, is why `OrphanedPartial` is whole-app.

`platformos-graph` already models both directions (`types.ts`: outgoing references, plus ingoing "references from other modules"), so the expensive part is BUILDING the graph, not querying it. On `supervisor-graph-integration` that build measured ~37 s on a real project.

### The decision

`OrphanedPartial` runs only under `singleFileOnly: false`, i.e. `pos-cli check`. The LSP and `validate_code` use the default and do not run it.

### Consequence — this REMOVES a diagnostic the LSP ships today

`getReferences` is currently wired ONLY in the LSP (`diagnostics/runChecks.ts`), which means `OrphanedPartial` works in the editor today and is already inert in check-node. So this decision:

- makes `validate_code`'s existing behaviour correct-by-declaration rather than accidental, AND
- **removes "This partial is not referenced by any other files" from the editor**, where it currently appears.

That is intentional, not an oversight: the diagnostic costs a whole-project parse to produce, and a per-keystroke editor path cannot pay it. Call it out in the changelog / check docs so it does not read as a regression — a partial that is genuinely orphaned will now be reported by `pos-cli check` (and CI) instead of in the editor.

Also drop `getReferences` from the LSP's `runChecks` dependency wiring, or the graph will still be built for a check that no longer consumes it.

### Escape hatch, deliberately not taken now

`OrphanedPartial` could rejoin the single-file set if the reverse index became cheap to keep warm — that is exactly TASK-9.15's "warm incremental persisted GraphCache". If that lands, revisit: the check would need `getReferences` wired for the LSP again, backed by an incrementally-maintained index rather than a per-run build. Do NOT re-enable it against a per-run graph build.
<!-- SECTION:NOTES:END -->
