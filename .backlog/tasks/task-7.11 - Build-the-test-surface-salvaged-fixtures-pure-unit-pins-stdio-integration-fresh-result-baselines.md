---
id: TASK-7.11
title: >-
  Build the test surface: salvaged fixtures, pure-unit pins, stdio integration,
  fresh result baselines
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
labels: []
dependencies:
  - TASK-7.10
references:
  - docs/mcp-supervisor/salvage/fixtures
  - docs/mcp-supervisor/salvage/OLD-parity-spec.ts
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Stand up the test suite for the new package, exploiting the pure architecture for fast, boot-free coverage.

## Scope
- Restore salvaged fixtures from `docs/mcp-supervisor/salvage/fixtures/` (project, broken-project, parity corpus) into the package test tree.
- Unit pins for the PURE stages (enrich/, advise/, result/) — the bulk; no server boot needed.
- Integration: a handful of features driven through the real stdio bin (MCP SDK client).
- A result-shape contract/snapshot test for ValidateCodeResult.
- Capture FRESH parity baselines against the NEW result shape (old `.expected.json` baselines are stale and must not be reused verbatim).
- Wire into root `yarn test`.

## Out of scope
- The old LSP-message-format contract test — intentionally NOT recreated (no string contract exists anymore).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pure-stage unit tests cover enrich/advise/result without booting a server
- [ ] #2 Integration tests exercise validate_code through the real stdio bin
- [ ] #3 Fresh result baselines are captured against the new ValidateCodeResult; no stale old baselines remain
- [ ] #4 Package tests run under root yarn test and pass
<!-- AC:END -->
