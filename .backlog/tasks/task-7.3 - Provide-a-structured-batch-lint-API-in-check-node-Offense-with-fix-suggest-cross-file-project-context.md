---
id: TASK-7.3
title: >-
  Provide a structured batch lint API in check-node (Offense[] with fix/suggest
  + cross-file project context)
status: Done
assignee:
  - filip
created_date: '2026-06-08 10:00'
updated_date: '2026-06-09 21:09'
labels: []
dependencies: []
references:
  - packages/platformos-check-node
  - packages/platformos-check-common/src/index.ts
modified_files:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/lint-buffer.spec.ts
  - packages/platformos-check-node/README.md
  - packages/platformos-check-node/CLAUDE.md
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Give the new supervisor a single, documented Node entrypoint that lints a buffer in the context of its project and returns check-common STRUCTURED `Offense[]` — structured `fix`/`suggest` and matched identifiers intact — without any LSP/JSON-RPC.

## Why
This is the typed seam between the engine and the supervisor. check-node already exposes `check(root)`; we need to confirm/extend it for the validate_code use case (one file under edit + the rest of the project on disk for cross-file checks like MissingPartial/MissingPage/OrphanedPartial) and guarantee no structure is lost in the node wrapper.

## Scope
- Audit `platformos-check-node` `check()`; confirm Offense carries structured fix/suggest end to end.
- Add (if missing) a "lint one buffer with project overlay" variant: the in-memory file under edit overlays the on-disk project so cross-file checks see unsaved content.
- Document the entrypoint in check-node README + CLAUDE.md.

## Out of scope
- Supervisor wiring (task-7.6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A documented check-node entrypoint returns Offense[] for a buffer + project root with structured fix/suggest preserved
- [x] #2 Cross-file checks resolve using on-disk project context, with the edited buffer overlaid in memory
- [x] #3 A check-node unit test pins the structured shape (fix/suggest present, check code, range)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (TASK-7.3 — audit + extend check-node)

### Audit outcome
- `check(root)`/`appCheckRun(root)` glob the whole project → `App` → check-common `coreCheck` → `Offense[]` with `fix`/`suggest` intact (Offense carries typed fix?/suggest?). No structure lost in the node wrapper.
- Missing: a "lint one buffer with project overlay" variant.

### Implementation
- Extracted private `lintApp(root, app, config, log)` (deps + docDefinitions + coreCheck) shared by `appCheckRun` and the new entrypoint. docDefinitions built from the PASSED app so the overlaid buffer's unsaved `{% doc %}` params are used (not stale disk).
- Added `lintBuffer({ root, filePath, content, configPath?, log? })`: load project from disk → `overlayBuffer` (replace the file's SourceCode with one built from the buffer; append if new) → `lintApp` → return offenses filtered to the buffer's uri. No LSP, no message round-trip.
- Preserved exact behavior of `appCheckRun` (kept the JSONValidator.create line) — verified by the existing 95 tests.
- Docs: README `lintBuffer` section + entrypoint table; new check-node CLAUDE.md (entrypoints, factory-config regen note, hermetic-test pattern).

### Verify
- check-node type-check clean; full suite 98/98 (95 existing + 3 new); prettier clean.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the typed lint seam to check-node: a documented `lintBuffer` entrypoint that lints an in-memory buffer in the context of its on-disk project and returns structured `Offense[]` — no LSP, no subprocess, no message-string round-trip.

**Implementation (`src/index.ts`):**
- Extracted private `lintApp(root, app, config, log)` — the deps + `getDocDefinition` map + `coreCheck` call — now shared by `appCheckRun` and `lintBuffer`. Building the doc-definition map from the PASSED app is what lets an overlaid buffer be cross-referenced with its UNSAVED `{% doc %}` params.
- `appCheckRun` delegates to `lintApp`; behavior preserved exactly (existing 95 tests still green).
- New `lintBuffer({ root, filePath, content, configPath?, log? })`: loads the project from disk (cross-file checks resolve against real files), overlays the buffer via `overlayBuffer` (replaces the file's SourceCode, or appends it when the file is new/unsaved), runs `lintApp`, and returns offenses filtered to the buffer's URI — with `fix`/`suggest` and all typed fields intact.

**Docs:** README gains an entrypoint table + a `lintBuffer` section with usage; added a concise check-node `CLAUDE.md` (entrypoints, the `lintApp` overlay rationale, the factory-config regeneration rule, and the hermetic-test pattern).

**Tests (`src/lint-buffer.spec.ts`, 3 hermetic — `extends: platformos-check:nothing` + one check, no docset/network):**
1. Structured shape: a buffer with single-quoted JSON-literal keys (disk copy is benign) yields a `JsonLiteralQuoteStyle` offense whose `.fix` is a function and whose `.start.index`/`.end.index` are a valid numeric range — pins fix preservation + that the BUFFER (not disk) was linted.
2. Cross-file: buffer rendering an on-disk partial → no `MissingPartial`.
3. Cross-file: buffer rendering a missing partial → `MissingPartial` fires — pins overlay + on-disk cross-file resolution.

**Verification:** check-node type-check clean; full suite 98/98; prettier-clean. AC#1 (documented entrypoint, fix/suggest preserved), AC#2 (cross-file + overlay), AC#3 (structured-shape pin) all met.
<!-- SECTION:FINAL_SUMMARY:END -->
