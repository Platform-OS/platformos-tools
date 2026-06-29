---
id: TASK-7.8
title: >-
  Single source of check metadata: derive supervisor hints/descriptions from
  check-common meta.docs
status: To Do
assignee: []
created_date: '2026-06-08 09:45'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/knowledge-loader.ts
  - packages/platformos-mcp-supervisor/src/data/checks
  - packages/platformos-mcp-supervisor/src/data/hints
parent_task_id: TASK-7
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Eliminate the second source of truth for "what a check means". The supervisor ships `data/checks/*.yml` and `data/hints/*.md` that redescribe checks whose canonical description already lives in check-common's `CheckDefinition.meta.docs.description`.

## Why
Two descriptions of the same check drift. The hint files contain genuinely supervisor-specific, agent-facing prose (fix guidance, see_also) that is worth keeping — but the base description/severity/recommended metadata should derive from check-common, not be re-authored.

## Scope
- Identify which fields in `data/checks/*.yml` duplicate check-common `meta` (code, description, severity, recommended) vs which are supervisor-only (agent hint templates, gotchas, see_also).
- Source the duplicated fields from check-common at load time (knowledge-loader.ts) instead of from YAML.
- Keep supervisor-only hint prose in `data/hints/*.md`; optionally validate that every shipped hint maps to a real check code.

## Out of scope
- Domain gotchas / content-triggers / language-features data (supervisor-specific, stays).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Check code/description/severity/recommended for supervisor hints derive from check-common meta, not re-authored YAML
- [ ] #2 A test asserts every data/hints/*.md maps to a known check code (no orphan hint files)
- [ ] #3 Supervisor-specific prose (agent guidance, see_also, gotchas) remains in data/ as before
<!-- AC:END -->
