---
id: TASK-9
title: >-
  Extend platformos-graph to own the project structural/dependency model the
  supervisor consumes
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
labels: []
dependencies: []
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/types.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
The rebuilt `validate_code` must tell agents not just *what is wrong* in a file but *how it sits in the project* — who renders it, what it renders/calls, whether it is orphaned, whether a target is missing, "did you mean" candidates, resource/CRUD completeness. The v1 supervisor did this with a BESPOKE in-supervisor graph + scanner (`project-fact-graph.ts`, `dependency-graph.ts`, `project-scanner.ts`, `render-flow.ts`) — exactly the duplicate-graph mistake the rebuild eliminates (ANALYSIS.md §6, invariant #3).

**Principle:** the supervisor is a pure consumer; ALL graph / project-structure functionality lives in `platformos-graph`. So we EXTEND `platformos-graph` to provide what the supervisor needs and resurrect the old `project-map` capabilities AS THE GRAPH PACKAGE'S API. The supervisor calls it and shapes the output into `ValidateCodeResult` — it re-implements no graph logic.

See ADR `docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md` for the full discovery + decision.

## Current state of platformos-graph (2026-06-12)
- `AppGraph` = modules with `dependencies` (outgoing) / `references` (incoming) `Reference[]`, `kind` (Page|Partial|Layout), `exists`.
- `Reference = { source, target, type: 'direct'|'indirect' }` — has call-site ranges but NO semantic kind and NO args.
- `traverseModule` extracts ONLY `{% render 'literal' %}`, asset filters, and `<custom-element>` edges; entry points are pages+layouts. So commands/queries/graphql files are largely absent; no function/graphql/include/layout edges; no query/project-map API; no per-file self-structural.

## Scope (extend the graph package; consume existing owners, don't duplicate)
Delegate to `platformos-check-common` for facts it already owns — partial `@param` signatures (`getDocDefinition`/liquid-doc), frontmatter validity + schema, docset. The graph composes those; it does not re-derive them.

## Constraints
- Additive changes only (e.g. an OPTIONAL `Reference.kind`) — `platformos-graph` is consumed by the LSP (`platformos_references` / `platformos_dependencies` / `platformos_dead_code`); re-verify those.
- The supervisor remains a pure consumer: zero graph/scanner logic added to `platformos-mcp-supervisor`.

This is the tracking epic. See child tasks. Prerequisite for the supervisor's structural enrichment (TASK-8.4) and the fuller TASK-7.6 ProjectContext.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 platformos-graph models function/graphql/include/layout edges (not just render/asset/web-component); command/query/graphql files are first-class nodes
- [ ] #2 platformos-graph exposes a documented project-structure/query API (dependents, orphan, reachability, missing-target, render-call args, nearest-name candidates, resource/CRUD completeness) that resurrects the old project-map capabilities
- [ ] #3 Facts owned by check-common (partial @param signatures, frontmatter, schema, docset) are consumed/composed, not duplicated, inside the graph package
- [ ] #4 The LSP consumers (references/dependencies/dead_code) remain correct (re-verified) and changes to shared types are additive
- [ ] #5 platformos-mcp-supervisor consumes this API and contains NO graph/scanner logic of its own
<!-- AC:END -->
