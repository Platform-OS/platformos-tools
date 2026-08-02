---
id: TASK-12.6.8
title: >-
  Introduce a singleFileOnly check partition (Ruby's single_file guard), default
  on
status: Done
assignee: []
created_date: '2026-07-31 16:56'
updated_date: '2026-08-01 21:00'
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
## Implemented

- `CheckDefinition.meta.singleFile?: boolean`, defaulting to `true`, documented as the
  scope of REPORTING rather than a cost budget.
- `CheckOptions.singleFileOnly?: boolean`, defaulting to `true`, filtering the check
  set in `checksOfType` — independently of `CheckOptions.only`, which still filters
  files.
- `OrphanedPartial` is the only `singleFile: false` check, with the reasoning in its
  own doc comment (forward vs reverse question).
- `appCheckRun` (i.e. `pos-cli check`) passes `singleFileOnly: false`. `lintBuffer` and
  the language server use the default.
- `getReferences` is no longer wired in the language server's `runChecks`, and
  `appGraphManager` was dropped from `makeRunChecks`'s parameters (it is still used for
  the LSP's own references/dependencies features).

## AC #2, "explicit classification": a full two-sided partition test

`single-file-partition.spec.ts` pins BOTH lists by name and asserts
`allChecks.length === SINGLE_FILE.length + WHOLE_APP.length`. Adding a check fails the
test until someone puts it on a side. That is stronger than a per-check `singleFile:
true` annotation (which reviewers would rubber-stamp) and does not add 36 lines of
noise to the check definitions.

## AC #8: MatchingTranslations is single-file — rationale

It reports on the translation file it is VISITING (`context.file`), comparing that
file's keys against the aggregated translation set that `getTranslationsForBase`
returns. It never reports on another file. That is category 2 — single-file report,
looked-up data — the same shape as `TranslationKeyExists`. Its cost is a handful of
YAML reads, not a project parse.

## AC #6: no stale diagnostics — structural, and tested

The LSP still lints the WHOLE app (no `only`) and iterates app FILES rather than
offenses when publishing, so every file is republished on every run and an offense that
no longer exists is cleared. `singleFileOnly` changes which CHECKS run, not which files
are reported on, so the Ruby `diagnostics_manager` per-path merge logic is not needed
here. Pinned by a test that fixes file B, edits file A, and asserts B is republished
with `diagnostics: []` at its new version.

## AC #9: documented as a deliberate trade

- `OrphanedPartial.meta.docs.description` now states it runs in whole-project runs
  only (`pos-cli check` and CI), not in the editor or `validate_code`, and why.
- `.changeset/lazy-app-model.md` calls the removal out explicitly, names `pos-cli
  check` as where it still runs, and lists the checks that are NOT affected
  (`MissingPage`, `MissingPartial`, `MissingAsset`, `TranslationKeyExists`,
  `PartialCallArguments`, `MatchingTranslations`).
- STILL TO DO OUTSIDE THIS REPO: the same note on the check's page in
  `~/projects/pos/platformos-documentation`.

## Ruby's `single_file_end_dependencies`: deliberately not ported

Ruby declares the extra files a check needs in single-file mode. In TypeScript those
files are reached implicitly and lazily through `getDocDefinition` /
`PartialCallArguments` — measured at 6 files on a 3138-file project — so an explicit
declaration would add a maintenance surface for something laziness already gets right.
Decided, not omitted.

## Test-helper default

`test-helper`'s `check()` defaults to `singleFileOnly: false`: a fixture-wide run
models a whole-project run, and a spec that names a check explicitly means to run it.
Specs that exercise the partition pass the flag.

## Acceptance criteria

- #1 ✔ · #2 ✔ · #3 ✔ (all five still report under `singleFileOnly: true`) · #4 ✔
  (asserted directly, with `getReferences` wired, so it is not incidental) · #5 ✔
  (`pos-cli check` path passes `false`; suite green) · #6 ✔ · #7 ✔ (pinned on
  TASK-12.6.3 with a spied parser) · #8 ✔ · #9 ◐ in-repo done, docs repo pending ·
  #10 ✔

## REVERTED (2026-08-01) — the partition's only member is gone

`OrphanedPartial` was removed (see TASK-29), and it was the sole `singleFile: false`
check, so the partition had nothing left to separate. `CheckOptions.singleFileOnly`,
`meta.singleFile` and `Dependencies.getReferences` are deleted; the editor,
`pos-cli check` and `validate_code` now run the same set of checks.

The reasoning that justified the partition still holds and is worth keeping in mind
if a whole-app check is ever proposed again: a check that asks what the REST of the
project says about a file cannot be answered without parsing all of it, and a
per-keystroke path cannot pay for that. What changed is the evidence about this
particular check — with the index actually built, it reported 350-465 warnings per
real project, and a large share were partials invoked by name through dispatchers and
callbacks, which no static index can see.
<!-- SECTION:NOTES:END -->
