---
id: TASK-7.2
title: >-
  Switch the supervisor lint path to a direct check-common call; retire the
  in-process LSP for linting
status: To Do
assignee: []
created_date: '2026-06-08 09:41'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/tools/validate-code.ts
  - packages/platformos-mcp-supervisor/src/core/lsp-client.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Replace the in-process language-server lint path in `validate_code` with a direct call to the structured node lint API from task-7.1. The supervisor receives `Offense[]` (structured fix/suggest intact) instead of awaiting `publishDiagnostics` strings.

## Why
`src/core/lsp-client.ts` (524 LOC) boots a full LSP over a PassThrough stream pair, with settle timeouts and a documented "HTTP fetch may outlive close()" caveat — accidental complexity bought to avoid the old `pos-cli` subprocess. For a request/response "lint this buffer" need, a direct library call is simpler, synchronous, fully typed, and preserves structure.

## Scope
- Introduce a structured-offense ingestion path in the orchestrator (`src/tools/validate-code.ts` step 2 "Lint").
- Keep the in-process LSP ONLY if hover/completions are still genuinely consumed by enrichment (`error-enricher` hover pass). If hover is the sole remaining use, scope it down to that; otherwise delete `lsp-client.ts`.
- Map structured `Offense` -> the internal diagnostic shape consumed by the pipeline, carrying through structured fields (matched identifier, fix, suggest) instead of a bare message string.

## Out of scope
- Removing the regex extractors yet (task-7.3) — keep them working during this step to avoid a big-bang change; they become dead once structured fields flow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 validate_code lints via the direct check-common node API; no JSON-RPC publishDiagnostics round-trip is used for linting
- [ ] #2 Structured Offense fields (check code, range, fix, suggest, matched identifier) reach the diagnostic pipeline
- [ ] #3 If the in-process LSP is retained, it is used ONLY for hover/completions and that is documented; otherwise lsp-client.ts is removed
- [ ] #4 Parity, integration, and upstream-contract suites pass (or divergences are explained and re-baselined intentionally)
<!-- AC:END -->
