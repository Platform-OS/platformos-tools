---
id: TASK-9.2
title: >-
  Add a project-structure query API to platformos-graph (resurrect the old
  project-map capabilities)
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
labels: []
dependencies:
  - TASK-9.1
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Expose, as `platformos-graph`'s public API, the project-structure queries the supervisor (and other consumers) need — resurrecting the capabilities of the old in-supervisor `ProjectFactGraph` / `ProjectMap` / `render-flow`, but OWNED by the graph package.

## Queries to provide (from the old fact inventory — see ADR 003)
- `dependentsOf(uri)` / `referencedBy` — callers of a file (now complete across render+function+graphql thanks to task-9.1).
- `isOrphan(uri)` — no incoming references (correctly scoped now that function/graphql edges exist).
- reachability (BFS over outgoing edges), `exists(uri)`, missing-target resolution.
- render/function/graphql call sites + args (from the call-site ranges; expose args where recoverable).
- nearest-name candidate sets over typed node names (partials, page routes, etc.) for "did you mean".
- resource/CRUD-completeness view (per schema table: related graphql/commands/queries/pages + missing expected operations) — the old `detectResources` / `ProjectMap.summary.resources`.

## Delegate, do not duplicate
- Partial `@param` signatures → check-common `getDocDefinition` / liquid-doc.
- Frontmatter (`slug`/`method`/`layout`) + schema properties + docset → check-common.
The query layer COMPOSES these; it does not re-derive them.

## Out of scope
- Per-file self-structural snapshot (task-9.3).
- Supervisor-side shaping into ValidateCodeResult (TASK-8.4).

## Constraints
- Pure/queryable over the built `AppGraph`; build/I/O stays in `buildAppGraph`.
- Documented + unit-tested; consumed by the supervisor with zero graph logic on the supervisor side.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 platformos-graph exposes documented query functions: dependents/orphan/reachability/exists/missing-target, call-sites+args, nearest-name candidates, and resource/CRUD completeness
- [ ] #2 Partial @param signatures, frontmatter, schema and docset are composed from check-common, not re-derived
- [ ] #3 Each query has unit pins over a fixture app graph
- [ ] #4 A consumer can obtain the full old project-map fact set from this API without any bespoke graph code
<!-- AC:END -->
