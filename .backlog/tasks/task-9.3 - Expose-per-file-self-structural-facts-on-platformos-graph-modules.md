---
id: TASK-9.3
title: Expose per-file self-structural facts on platformos-graph modules
status: To Do
assignee: []
created_date: '2026-06-23 10:33'
labels: []
dependencies:
  - TASK-9.1
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Expose a file's OWN structural declarations per module so consumers do not re-run an `extractAllFromAST`-style pass. `platformos-graph` already parses every file while building the graph; surface the by-product.

## Facts (the old single-file `ValidateCodeStructuralSnapshot`)
`renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`, `layout`, `method`.

## Owner decision (ADR 003 open question #1)
Preferred owner is `platformos-graph` (it already parses the app). If parsing/extraction is better placed in a shared check-common/common util, expose it from there and have the graph compose it — but the consumer (supervisor) must get these facts WITHOUT parsing the file itself. Resolve the owner as part of this task and record it in ADR 003.

## Constraints
- Frontmatter-derived facts (`slug`/`method`/`layout`) should reuse check-common frontmatter parsing, not a second parser.
- Additive to the module shape; existing consumers unaffected.

## Out of scope
- Cross-file queries (task-9.2); supervisor result shaping (TASK-8.4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A module's own structural declarations (renders/graphql/filters/tags/translation_keys/doc_params/slug/layout/method) are obtainable from platformos-graph without the consumer parsing the file
- [ ] #2 Frontmatter-derived fields reuse check-common parsing (no second frontmatter parser)
- [ ] #3 The owner decision (graph vs shared util) is recorded in ADR 003
- [ ] #4 Unit pins cover the exposed self-structural for representative file types
<!-- AC:END -->
