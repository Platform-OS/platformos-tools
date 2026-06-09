---
id: TASK-7.1
title: >-
  Establish the architecture doc and machine-enforced non-goals for the new
  package
status: Done
assignee:
  - filip
created_date: '2026-06-08 10:00'
updated_date: '2026-06-09 16:12'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md
modified_files:
  - packages/platformos-mcp-supervisor/ARCHITECTURE.md
  - docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md
  - packages/platformos-mcp-supervisor/test/guards/scan.ts
  - >-
    packages/platformos-mcp-supervisor/test/guards/architecture-invariants.spec.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Write the new `ARCHITECTURE.md` + an ADR for the new package describing the sound design (see epic), and add MACHINE-ENFORCED guards so the architectural invariants cannot silently rot.

## Why first
The whole point of the rebuild is to not repeat the old coupling. Encoding the invariants as tests/lint rules up front means every later task is checked against them automatically.

## Scope
- ARCHITECTURE.md: layering, module boundaries (transport/lint/enrich/advise/result/data), the typed seam, the invariants list.
- ADR under `docs/mcp-supervisor/decisions/` recording: why rebuilt, why no in-process LSP for lint, why structured contract, why packages stay separate.
- Guard tests (run in the package vitest):
  * dependency guard: the package MUST NOT import `platformos-language-server-*` for the lint path (assert via import graph / a denylist test).
  * no-regex-message-parsing guard: a test that fails if `enrich/` reads diagnostic `message` strings to extract params.
  * purity guard: `enrich/` and `result/` modules import no `node:fs` / no process / no I/O.

## Out of scope
- Implementing the modules (later tasks); this defines + guards the contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ARCHITECTURE.md and an ADR document the layering, typed seam, and the 7 invariants from the epic
- [x] #2 A test fails if the package imports a language server for linting
- [x] #3 A test fails if enrich/ or result/ modules import node:fs / perform I/O
- [x] #4 A test/lint fails if enrich/ extracts params by regex over diagnostic message strings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach (TASK-7.1 — docs + machine-enforced guards; NO runnable package yet)

### Context discovered
- The package dir is fully UNTRACKED (git ls-files = 0): stale `dist/`, `node_modules/`, reference `.md` docs, `test/fixtures/` are working-tree only. `dist`/`node_modules` are gitignored. Package removed at f60bc39.
- Root `vitest.config.mjs` globs ALL packages and excludes `**/dist/**`; siblings have no per-package vitest config. So guard specs placed under the package are auto-discovered by root vitest with zero package config.
- `findRoot` + `makeFileExists` are exported from `@platformos/platformos-check-common` (confirmed).
- ADR convention: `docs/mcp-supervisor/decisions/NNN-slug/README.md`; next is `002-`.

### 7.1 / 7.4 seam (decision)
Keep 7.1 to its stated scope: docs + guards only. NO package.json / tsconfig / runtime deps — those are 7.4. Guards are filesystem/source SCANNERS (no build, no module imports of the package), runnable today under root vitest. They scan the new `src/**` (vacuously pass while empty; bite once populated) and `package.json` if present.

### Deliverables (≤5 files)
1. `packages/platformos-mcp-supervisor/ARCHITECTURE.md` — layering (transport/lint/enrich/advise/result/data), the typed `Offense` seam, the 7 invariants verbatim from the epic, module boundaries, request flow sketch.
2. `docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md` — ADR (why rebuild, why no in-process LSP for lint, why structured contract, why packages stay separate). Filled from ADR_TEMPLATE.
3. `packages/platformos-mcp-supervisor/test/guards/scan.ts` — shared source-scanning helpers (list .ts files under a dir excluding *.spec.ts; ENOENT-safe; import extraction; message-regex heuristic) + exported pure detectors for self-testing.
4. `packages/platformos-mcp-supervisor/test/guards/architecture-invariants.spec.ts` — the three guards + good/bad self-test fixtures:
   * dependency guard: no `platformos-language-server-*` in package.json deps; no LS import in src/{lint,enrich,advise,result,transport}.
   * purity guard: src/{enrich,result} import no fs/child_process/net/http/https/os/process and no `../lint`.
   * no-regex-message-parsing guard: src/enrich/** contains no `.message` + regex-op pattern; no `diagnostic-record`/`extractParams` import.

### Verify
- `yarn vitest run packages/platformos-mcp-supervisor/test/guards` → all pass (vacuous over empty src + self-tests prove failure-on-violation).
- Prove AC by self-test fixtures (known-bad string flagged, known-good not), so "a test fails on violation" is pinned without real violating source.
- `yarn format:check` on new TS.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Established the v2 architecture contract + machine-enforced guards for the rebuilt supervisor.

**Docs**
- `packages/platformos-mcp-supervisor/ARCHITECTURE.md` — layering (transport/lint/enrich/advise/result/data/bin), per-layer responsibilities + allowed-deps table, the typed `Offense` seam (graph + docset), request flow, the 7 invariants verbatim, the guard→invariant mapping, and explicit scope boundaries (this phase = clean minimal validate_code; TASK-8 = restore per-domain + rule-library intelligence; permanently-out analytics/other-tools).
- `docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md` — ADR: why rebuild not refactor, the lossy structured→string→structured round-trip diagnosis, alternatives considered, the 7 decisions, consequences (incl. the check-common `data` cost and the interim narrower output until TASK-8), reversibility (git f60bc39 + salvage).

**Machine-enforced guards** (`test/guards/`, run under repo-root vitest — no package config needed):
- `scan.ts` — ENOENT-safe source lister + a comment-stripping char-state scanner + exported pure detectors (`isLanguageServerSpecifier`, `isIoSpecifier`, `usesProcessGlobal`, `hasMessageRegexParsing`, `usesLegacyParamExtraction`, `extractImportSpecifiers`).
- `architecture-invariants.spec.ts` — three real-source guards (#1 no language-server on the lint path incl. package.json denylist; #5 enrich/result pure — no I/O import, no `process.*`, no import of lint/; #2 enrich/ never regex-parses `.message` and never reintroduces extractParams/templateOf/diagnostic-record) + inline good/bad SELF-TESTS pinning each detector's failure behaviour.

**Verification**
- 12/12 guard tests pass over the (currently empty) src tree (vacuous-pass by design).
- Proved real-source guards BITE: injecting a violating `src/enrich/_violation.ts` (LS import + node:fs + process.cwd + `diag.message.match(/.../)`) produced exactly 4 failures across invariants #1/#5/#2; cleanup reverted.
- Prettier: both TS files conform to repo style.

**Design decision (7.1/7.4 seam):** kept 7.1 to docs + guards only. No package.json/tsconfig/runtime deps — those remain TASK-7.4. Guards are filesystem scanners discovered by the existing root vitest, so they are live now and require no package scaffolding. package.json denylist check no-ops until 7.4 creates it.
<!-- SECTION:FINAL_SUMMARY:END -->
