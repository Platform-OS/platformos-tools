---
id: TASK-7.10
title: Wire the validate_code handler end-to-end with full/quick modes
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-06-12 13:17'
labels: []
dependencies:
  - TASK-7.9
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Replace the stub handler (task-7.4) with the real composition: lint/ -> enrich/ -> advise/ -> result/. Implement `full` and `quick` modes (quick skips the heavier ergonomic stages).

## Scope
- Compose the stages behind validate_code; thread ProjectContext (cached) through.
- Define mode behaviour explicitly and document it.
- Map internal errors to a typed tool error/status.
- Update README + ARCHITECTURE.md with the final request flow.

## Out of scope
- New tools beyond validate_code (additive later).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 validate_code runs the real lint -> enrich -> advise -> result composition and returns a typed ValidateCodeResult
- [ ] #2 full and quick modes behave as documented
- [ ] #3 README and ARCHITECTURE.md describe the final request flow
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

Everything else is empty/null: `proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`, `structural`; `next_step` omitted; `parse_error` stays null (syntax errors surface as `LiquidHTMLSyntaxError` diagnostics). Fixes are NOT translated (`Offense.fix`/`suggest` deferred to enrich). `mode` is accepted but a no-op (no heavy stages yet).

### Files
- `src/transport/validate-code.ts` — handler body replaced (stub → runLint+assembleResult).
- `src/lint/lint.ts`, `src/result/assemble.ts` (see TASK-7.6 / TASK-7.9 notes).

### Verification
- Package suite 31/31 (assemble 5, args 8, guards 12, lint 3, smoke 3). stdio-smoke now drives the REAL bin end-to-end: clean layout → status ok; layout missing `content_for_layout` → MissingContentForLayout error with numeric line/column. Architecture guards still 12/12. Build + type-check clean; prettier-clean.

### NOT yet done (remaining 7.10 scope)
- enrich → advise → richer result composition; explicit full vs quick behaviour; typed tool-error mapping for handler failures; README + ARCHITECTURE request-flow update.
<!-- SECTION:NOTES:END -->
