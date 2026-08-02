---
id: TASK-7.10
title: Wire the validate_code handler end-to-end (lint -> enrich -> advise -> result)
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-08-01 21:04'
labels: []
dependencies:
  - TASK-7.9
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Replace the stub handler (task-7.4) with the real composition: lint/ -> enrich/ -> advise/ -> result/.

## Scope
- Compose the stages behind validate_code; thread ProjectContext (cached) through.
- Map internal errors to a typed tool error/status.
- Update README + ARCHITECTURE.md with the final request flow.

## Out of scope
- New tools beyond validate_code (additive later).
- Analysis MODES. `mode: full | quick` was removed on 2026-08-01 (TASK-12.5): the only
  thing it could have selected was the whole-project check partition, and that went
  away with `OrphanedPartial` (TASK-29). Every check the linter has answers for one
  file, so there is no deeper pass to offer. Do not reintroduce a depth knob without a
  stage that actually costs something — and note that the SDK drops unknown arguments,
  so calls that still send `mode` keep working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 validate_code runs the real lint -> enrich -> advise -> result composition and returns a typed ValidateCodeResult
- [ ] #2 README and ARCHITECTURE.md describe the final request flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Partial progress — lint-only slice (2026-06-12)

The handler no longer returns a stub: it now calls `runLint` → `assembleResult` and returns REAL detection results. (User-directed descope: wire ONLY the lint part now; enrich/advise + full result come later.)

### What `validate_code` does NOW
1. Resolve the file path: `file_path` used as-is if absolute, else joined onto `ctx.projectDir`; lint root = `ctx.projectDir`.
2. `lintBuffer({ root, filePath, content })` (check-node, TASK-7.3) — runs check-common `check()` over the on-disk project with the buffer overlaid; cross-file checks resolve; NO LSP, NO subprocess.
3. Map each `Offense` → `ValidateCodeDiagnostic`: `check`, `severity` (error/warning/info), `message`, and **1-based** line + column (check-common positions are 0-based for BOTH line and char — `getPosition` uses `origin:0` — so both get +1; matches v1's 0→1 conversion step).
4. `assembleResult` buckets into errors/warnings/infos; `status` = error>warning>ok; `must_fix_before_write` = (has errors).

Everything else is empty/null: `proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`, `structural`; `next_step` omitted; `parse_error` stays null (syntax errors surface as `LiquidHTMLSyntaxError` diagnostics). Fixes are NOT translated (`Offense.fix`/`suggest` deferred to enrich). (`mode` was accepted and ignored at the time; it has since been removed.)

### Files
- `src/transport/validate-code.ts` — handler body replaced (stub → runLint+assembleResult).
- `src/lint/lint.ts`, `src/result/assemble.ts` (see TASK-7.6 / TASK-7.9 notes).

### Verification
- Package suite 31/31 (assemble 5, args 8, guards 12, lint 3, smoke 3). stdio-smoke now drives the REAL bin end-to-end: clean layout → status ok; layout missing `content_for_layout` → MissingContentForLayout error with numeric line/column. Architecture guards still 12/12. Build + type-check clean; prettier-clean.

### NOT yet done (remaining 7.10 scope)
- enrich → advise → richer result composition; typed tool-error mapping for handler failures; README + ARCHITECTURE request-flow update.

## `mode` is gone, not deferred (2026-08-01)

An earlier note here said the `full` / `quick` axis was decided and wired. It was, and
then it was removed the same day: the axis rode on `singleFileOnly`, whose only member
was `OrphanedPartial`, and that check was deleted after measurement showed 350-465
warnings per real project with a large share of them wrong (TASK-29). `mode` is off
the input schema entirely, `assembleResult` no longer takes it, and `ValidateCodeMode`
is deleted. A retired argument is ignored rather than rejected — pinned by the stdio
smoke test — so agents that still send `mode` are unaffected.
<!-- SECTION:NOTES:END -->
