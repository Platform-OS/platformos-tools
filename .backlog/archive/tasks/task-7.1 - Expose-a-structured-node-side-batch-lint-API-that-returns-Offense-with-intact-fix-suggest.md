---
id: TASK-7.1
title: >-
  Expose a structured node-side batch lint API that returns Offense[] with
  intact fix/suggest
status: To Do
assignee: []
created_date: '2026-06-08 09:38'
labels: []
dependencies: []
references:
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-check-node
parent_task_id: TASK-7
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Give the supervisor a way to lint a buffer (and its project context) and get back check-common's STRUCTURED `Offense[]` — including the structured `fix`/`suggest` correctors and the matched identifiers — without going through the LSP `publishDiagnostics` string boundary.

## Why
This is the enabler for the whole epic. Today the only batch path is the in-process LSP, which flattens offenses to message strings. check-common already exposes `check(app, config, dependencies)` returning `Offense[]`, and `platformos-check-node` wraps it with a Node `AbstractFileSystem`/docset. We need a clean, documented entrypoint the supervisor can call in-process and synchronously (no JSON-RPC).

## Scope
- Audit `platformos-check-node` for an existing batch `check(root)` entry and confirm what it returns (it should already surface `Offense` with `fix`/`suggest`).
- If `Offense` loses structured fix/suggest anywhere in the node wrapper, fix that so consumers get the full structure.
- Provide/confirm a single-buffer-with-project-context variant suitable for `validate_code` (lint one file using the rest of the project on disk for cross-file checks like MissingPartial/MissingPage/OrphanedPartial).
- Document the entrypoint in check-node README + the package CLAUDE.md.

## Out of scope
- Changing any check logic.
- Touching the supervisor (done in task-9).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A documented node entrypoint returns Offense[] for a given file + project root, with structured fix and suggest preserved
- [ ] #2 Cross-file checks (MissingPartial, MissingPage, OrphanedPartial) work through this entrypoint using on-disk project context
- [ ] #3 Unit test in check-node pins the structured shape (fix/suggest present, check code, range)
<!-- AC:END -->
