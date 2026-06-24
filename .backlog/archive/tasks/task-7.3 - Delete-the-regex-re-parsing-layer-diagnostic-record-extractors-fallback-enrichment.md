---
id: TASK-7.3
title: >-
  Delete the regex re-parsing layer (diagnostic-record extractors + fallback
  enrichment)
status: To Do
assignee: []
created_date: '2026-06-08 09:41'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/diagnostic-record.ts
  - packages/platformos-mcp-supervisor/src/core/error-enricher.ts
  - >-
    packages/platformos-mcp-supervisor/test/upstream/lsp-diagnostic-contract.spec.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Once structured offenses flow (task-7.2), remove the brittle string round-trip: the 16 per-check regex extractors in `diagnostic-record.ts` and the per-check fallback regex enrichment in `error-enricher.ts`. Read typed fields off the structured offense instead.

## Why
`diagnostic-record.ts` (`templateOf`, `extractParams`) reconstructs structured params from English LSP messages and is explicitly pinned "byte-for-byte" by the upstream contract test — the single most fragile coupling in the codebase. It exists ONLY because structure was lost at the LSP boundary. With structure restored it is dead weight.

## Scope
- Replace `diag.params.X` reads with structured fields from the Offense.
- Remove `extractParams` / `templateOf` (or reduce to whatever genuinely has no structured equivalent, documented).
- Remove the fallback regex block in `error-enricher.ts`; rules match on structured `check` + typed fields.
- Re-evaluate `lsp-diagnostic-contract.spec.ts` — it pins message strings to protect the extractors; rescope or retire it.

## Out of scope
- Rule semantics (which hint fires) — only the SOURCE of the params changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 diagnostic-record.ts regex extractors are removed (or reduced to a documented, justified minimum)
- [ ] #2 error-enricher.ts no longer regex-parses LSP message strings; rules read structured fields
- [ ] #3 The upstream message-format contract test is retired or rescoped, with rationale recorded
- [ ] #4 Supervisor test suites pass
<!-- AC:END -->
