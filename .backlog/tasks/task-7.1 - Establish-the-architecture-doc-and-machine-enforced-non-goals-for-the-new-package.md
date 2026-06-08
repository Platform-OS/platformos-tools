---
id: TASK-7.1
title: >-
  Establish the architecture doc and machine-enforced non-goals for the new
  package
status: To Do
assignee: []
created_date: '2026-06-08 10:00'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/salvage/OLD-ARCHITECTURE.md
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
- [ ] #1 ARCHITECTURE.md and an ADR document the layering, typed seam, and the 7 invariants from the epic
- [ ] #2 A test fails if the package imports a language server for linting
- [ ] #3 A test fails if enrich/ or result/ modules import node:fs / perform I/O
- [ ] #4 A test/lint fails if enrich/ extracts params by regex over diagnostic message strings
<!-- AC:END -->
