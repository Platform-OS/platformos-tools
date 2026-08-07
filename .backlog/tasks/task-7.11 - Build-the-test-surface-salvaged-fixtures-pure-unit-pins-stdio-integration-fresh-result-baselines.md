---
id: TASK-7.11
title: >-
  Build the test surface: salvaged fixtures, pure-unit pins, stdio integration,
  fresh result baselines
status: To Do
assignee: []
created_date: '2026-06-08 10:17'
updated_date: '2026-08-07 14:48'
labels: []
dependencies:
  - TASK-7.10
references:
  - docs/mcp-supervisor/salvage/fixtures
  - docs/mcp-supervisor/salvage/OLD-parity-spec.ts
parent_task_id: TASK-7
priority: high
ordinal: 14000
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — half satisfied, half blocked on stages that do not exist

The package has **22 spec files**, including real stdio integration
(`test/integration/stdio-smoke.spec.ts`, `graph-build-worker.spec.ts`,
`process-guards-survival.spec.ts`), and they run under the root `yarn test` (part of the
current 361 files / 3859 tests, all passing). **ACs #2 and #4 are met.**

**AC #1 cannot be met yet**: it asks for pure-stage unit tests covering `enrich/`,
`advise/` and `result/`. Only `result/` exists — `src/enrich/` and `src/advise/` have
never been created (TASK-7.7, TASK-7.8). The `result/` half is covered
(`assemble.spec.ts`, `blocking.spec.ts`, `blocking-emission.spec.ts`,
`response-budget`…).

**AC #3 ("fresh result baselines … no stale old baselines remain") needs re-reading
against TASK-12.5**, which changed the result shape substantially — six fields removed,
a clean-file result going from 15 keys to 6 — and added an exact-key-set guard in
`assemble.spec.ts`. Any baseline captured before that is stale by definition; any
captured after already reflects the current shape.

Realistically this task is now "test enrich/ and advise/ when they exist", which makes it
a follow-on to 7.7/7.8 rather than independent work.
<!-- SECTION:NOTES:END -->
