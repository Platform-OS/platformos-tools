---
id: TASK-7.6
title: >-
  Replace the duplicate project graph
  (project-fact-graph/dependency-graph/project-scanner) with platformos-graph
status: To Do
assignee: []
created_date: '2026-06-08 09:44'
updated_date: '2026-06-08 09:53'
labels: []
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/core/project-fact-graph.ts
  - packages/platformos-mcp-supervisor/src/core/dependency-graph.ts
  - packages/platformos-mcp-supervisor/src/core/rules/queries.ts
  - packages/platformos-graph
parent_task_id: TASK-7
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Replace the supervisor's hand-rolled cross-file analysis (`project-fact-graph.ts`, `dependency-graph.ts`, `project-scanner.ts`, `project-map.ts`) with the existing `@platformos/platformos-graph` package that check-common already uses for cross-file checks.

## Why
The supervisor re-derives render/function/graphql resolution and orphan/dependent analysis that platformos-graph already implements. Two graph implementations will drift, and the supervisor's rule `queries.ts` helpers (nearestByLevenshtein, partialsReachableFrom, dependentsOf, isOrphan...) reimplement graph queries.

## Scope
- Map the rule-engine fact needs (`RuleFacts.graph`) onto platformos-graph queries.
- Keep the TTL project-map cache concept if still needed for performance, but back it with platformos-graph.
- Remove the duplicated scanner/graph modules once callers are migrated.

## Risks
- platformos-graph may not expose every query the supervisor needs (e.g. Levenshtein did-you-mean). Where it does not, keep a thin supervisor-side helper ON TOP of the shared graph rather than a parallel graph.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Supervisor cross-file facts are sourced from platformos-graph; project-fact-graph.ts and dependency-graph.ts are removed or reduced to thin adapters
- [ ] #2 Rule helpers in queries.ts that duplicate graph traversal are removed in favour of platformos-graph queries
- [ ] #3 Cross-file rules (MissingPartial nearest/orphan/dependents) behave identically — parity suite passes
<!-- AC:END -->
