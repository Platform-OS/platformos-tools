---
id: TASK-8.2
title: >-
  Build the per-domain intelligence layer (domain detection, gotchas, tips,
  domain_guide)
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
labels: []
dependencies:
  - TASK-7
references:
  - docs/mcp-supervisor/salvage/data/domain-gotchas.yml
  - docs/mcp-supervisor/salvage/data/content-triggers.yml
  - packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md
parent_task_id: TASK-8
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Implement the supervisor's per-domain layer as PURE functions over `(AST, structural snapshot, domain, diagnostics, knowledge)`. This is the supervisor's single largest piece of irreducible value and is entirely absent from check-common (verified: check-common has NO domain concept).

## Why
`validate_code` in v1 is domain-aware end to end. None of this exists in the linting engine and none of it is owned by a TASK-7 task. Restoring it is what makes the output platformOS-shaped rather than generic lint.

## The pieces (from v1 / salvage)
- Domain detection from path: `getDomainFromPath` (pages / partials / layouts / commands / queries / graphql / schema / translations). Reuse check-common/check-node file-type helpers where they overlap; only the platformOS domain mapping is supervisor-specific.
- Triggered gotchas: `domain-gotchas.yml` with the three trigger forms `always`, `has_check:<Check>`, `uses_tag:<tag>` -> the matching reminders.
- Domain-scoped content-trigger `tips`: `content-triggers.yml` (regex over file content, scoped by `domains:`), e.g. the `| raw` XSS advisory. Tips are advisory infos; they do NOT contribute to `must_fix_before_write`.
- The `domain_guide` result field (full mode): the triggered-gotcha bundle for the file's domain.
- Domain input to the scorecard (the scorecard transform itself lives in result/ task-7.9 / task-8.4; this task supplies the domain + gotcha signal it consumes).

## Constraints
- PURE (no node:fs / process / I/O) — content and AST are passed in by the handler; the task-7.1 purity guard must pass.
- Data comes from the knowledge layer (task-7.5); this task is logic only.
- Advisories that are AST/domain guidance use the `pos-supervisor:` namespace and must not collide with check codes (reuse the task-7.8 collision guard).

## Out of scope
- Generic (non-domain) advisories already covered by task-7.8.
- Result envelope assembly of `tips`/`domain_guide` fields (task-8.4 wires them into ValidateCodeResult; this task produces them).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Domain detection maps a file path to the correct platformOS domain for all of pages/partials/layouts/commands/queries/graphql/schema/translations, with unit pins
- [ ] #2 Triggered gotchas fire correctly for each trigger form (always, has_check:X, uses_tag:X) and are scoped to the file's domain
- [ ] #3 Content-trigger tips fire on content match scoped by domain (incl. the | raw XSS advisory) and never set must_fix_before_write
- [ ] #4 The domain_guide bundle is produced for full mode; all functions in this layer are pure (task-7.1 purity guard passes)
<!-- AC:END -->
