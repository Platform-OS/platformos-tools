---
id: TASK-7.5
title: >-
  Build the knowledge/data layer (salvaged prose) with base metadata derived
  from check meta
status: To Do
assignee: []
created_date: '2026-06-08 10:01'
labels: []
dependencies:
  - TASK-7.4
references:
  - docs/mcp-supervisor/salvage/data
  - packages/platformos-check-common/src/checks
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Load the salvaged knowledge assets and expose them to enrichment, with a SINGLE source of metadata: prose lives in data/, but base metadata (check code/description/severity/recommended) is read from check-common `meta`, not re-authored.

## Scope
- Copy salvaged `docs/mcp-supervisor/salvage/data/` into the package `data/` (hints/*.md, gotchas, content-triggers, shopify-contamination, language-features). Drop the parts that only re-describe check metadata.
- `knowledge/` loader: lazy-load + cache; resolve a hint for a `(checkCode, variant)`.
- Derive base check metadata from check-common at load time.
- Validation test: every shipped `hints/*.md` maps to a real check code (no orphans); no data file re-states a description that check meta already owns.

## Out of scope
- Applying hints to diagnostics (task-7.7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Knowledge loader serves hint prose, gotchas, content-triggers, and contamination data from data/
- [ ] #2 Base check metadata (code/description/severity) is sourced from check-common meta, not duplicated in data/
- [ ] #3 A test asserts every hints/*.md maps to a known check code and no data file duplicates check meta descriptions
<!-- AC:END -->
