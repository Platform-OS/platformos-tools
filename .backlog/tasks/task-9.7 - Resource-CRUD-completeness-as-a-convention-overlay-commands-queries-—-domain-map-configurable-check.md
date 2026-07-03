---
id: TASK-9.7
title: >-
  Resource/CRUD completeness as a convention overlay (commands/queries) — domain
  map + configurable check
status: To Do
assignee: []
created_date: '2026-06-30 11:30'
updated_date: '2026-06-30 11:30'
labels: []
dependencies:
  - TASK-9.6
references:
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
The old `detectResources` resource/CRUD completeness. Per ADR 004 this is CONVENTION truth (the `core` module's commands/queries pattern), NOT platform truth, so it must live OUTSIDE platformos-graph's neutral model — layered on top of the platform facts from TASK-9.6.

## Split by output type (ADR 004)
1. **Descriptive resource map** ("resource/table → its commands/queries/graphql/pages"): project-map data to show an agent; not an offense. Home: the supervisor per-domain layer (TASK-8) OR a clearly-quarantined `platformos-graph/conventions/*` exported separately from the neutral query API. Preferred: domain layer, keeping the graph pristine. Composes TASK-9.6 facts (schema tables, graphql table, slug) + the graph's function-edges-to-partials grouped by convention.
2. **Prescriptive completeness warnings** ("table X has a query but no create command/mutation"): opinionated + toggleable → a configurable custom check in platformos-check-common (e.g. `ResourceCompleteness`), scoped to schema files, default-off or clearly advisory, consuming the project graph. Apps not following the convention disable it via `.platformos-check.yml`.

## Convention rules (mirror old detectResources, but as a labeled overlay)
- pluralize(table) grouping; `/commands/{plural}/`, `/queries/{plural}/` path roots; graphql by `{plural}/` prefix OR graphql `table` (from TASK-9.6); pages by slug === plural or `{plural}/` prefix; expected ops: search/list, find/get, create, update, delete.
- Command/query path roots MUST be configurable (module-defined convention; do NOT hardcode unconfigurably) — see ADR 004 "deepest layer".

## Hard constraints
- platformos-graph stays convention-free (ADR 004). This overlay consumes graph facts; it does not push convention into the graph core.
- Supervisor remains a pure consumer.
- Depends on TASK-9.6 (platform facts).

## References
- ADR docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
- Old impl: pos-mcp src/core/project-scanner.js detectResources (git f60bc39)</parameter>
<parameter name="acceptanceCriteria">["Resource/CRUD completeness is implemented as a convention overlay OUTSIDE platformos-graph's neutral model (domain layer for the descriptive map; configurable check for prescriptive warnings) per ADR 004", "Descriptive map groups commands/queries/graphql/pages per table by convention, composing TASK-9.6 platform facts; command/query path roots are configurable, not hardcoded", "Prescriptive completeness warnings are a toggleable check (default-off or advisory), disableable via .platformos-check.yml for apps not using the convention", "platformos-graph contains NO command/query/resource convention; supervisor contains no bespoke graph/scanner logic", "Depends on TASK-9.6; TDD with fixtures; all consumers re-verified green"]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resource/CRUD completeness is implemented as a convention overlay OUTSIDE platformos-graph's neutral model (domain layer for the descriptive map; configurable check for prescriptive warnings) per ADR 004
- [ ] #2 Descriptive map groups commands/queries/graphql/pages per table by convention, composing TASK-9.6 platform facts; command/query path roots are configurable, not hardcoded
- [ ] #3 Prescriptive completeness warnings are a toggleable check (default-off or advisory), disableable via .platformos-check.yml for apps not using the convention
- [ ] #4 platformos-graph contains NO command/query/resource convention; supervisor contains no bespoke graph/scanner logic
- [ ] #5 Depends on TASK-9.6; TDD with fixtures; all consumers re-verified green
<!-- AC:END -->
