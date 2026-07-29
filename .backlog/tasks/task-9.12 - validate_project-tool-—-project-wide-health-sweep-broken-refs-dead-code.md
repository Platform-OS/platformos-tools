---
id: TASK-9.12
title: validate_project tool — project-wide health sweep (broken refs + dead code)
status: To Do
assignee: []
created_date: '2026-07-01 21:15'
updated_date: '2026-07-01 21:21'
labels:
  - mcp-supervisor
  - platformos-graph
  - validation
  - tool
dependencies:
  - TASK-9.10
references:
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
  - packages/platformos-graph/src/graph/query.ts
  - SUPERVISOR-GRAPH-INTEGRATION.md
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. `validate_code` is per-file and forward-looking; it cannot answer project-scale correctness ("is anything broken or dead ANYWHERE?"). An LLM finishing a change wants a final sweep before declaring done — and a CI gate wants the same. The graph-unique part of that sweep is DEAD CODE / ORPHANS (files nothing references), which no per-file tool can produce.

WHAT. A `validate_project` MCP tool that reports whole-project structural health from the cached graph:
- BROKEN REFERENCES across the project — every edge whose target does not resolve on disk, via `missingTargets(graph)`, grouped by kind (render/include/function/background/graphql/asset) and by source file. (This is the project-wide superset of what validate_code's lint catches per file.)
- DEAD CODE / ORPHANS — existing, non-entry-point, non-schema files that nothing references, via `orphans(graph)`. This is the genuinely graph-unique signal.
- (Optional, phase 2) a rolled-up lint summary across files, if cheap to include; the broken-refs + orphans are the core.

HARD RULES:
- BOUNDED, GROUPED output — never a raw dump. Group broken refs by kind + source; cap/paginate orphans; give totals. This is a triage list, not the graph.
- ORPHAN COMPLETENESS depends on build scope: `orphans`/`dependentsOf` are only complete if the graph is built with EVERY file as an entry point (see query.ts header) — a page/layout-only build under-reports. This tool MUST use (or trigger) a whole-project build scope, and the output must state its scope. Coordinate with the TASK-9.10 cache (the cache's build scope must support this, or this tool builds with all-files entry points).
- NON-MISLEADING: an orphan list that is really "unreachable from a too-narrow entry-point set" is a trap. Either guarantee complete scope or label results as scoped. A cold/unbuildable graph degrades gracefully (no false "all clean").
- REUSE: `missingTargets` + `orphans` from the graph query API; the supervisor owns only tool wiring + triage-shaping. No re-derivation.
- Respect ADR 004: broken-ref/orphan detection is platform-neutral (edges + reachability), NOT the commands/queries convention — keep it convention-free (resource/CRUD completeness belongs to project_map's overlay, not here).

NAMING: `validate_project` chosen for consistency with the supervisor's validate_* family (validate_code, validate_intent). `check_project` is the alternative if we want to reserve "validate" for write-gates; decide during impl.

Distinct from the other two tools: validate_project = HEALTH (task end / CI, "is anything broken or dead"); project_map = DISCOVERY (task start); validate_code blast-radius = CHANGE SAFETY (edit time). Lower urgency than 9.10/9.11 — most per-file correctness is already achievable by iterating validate_code; the unique value here is the dead-code/orphan sweep.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `validate_project` MCP tool is registered on both transports, reporting project-wide structural health from the cached graph in BOUNDED, grouped form (never a raw dump).
- [ ] #2 Broken references: every unresolved edge across the project via missingTargets(graph), grouped by kind and by source file, with totals.
- [ ] #3 Dead code / orphans: existing non-entry-point non-schema files nothing references via orphans(graph), capped/paginated with a total.
- [ ] #4 Orphan/broken-ref completeness is guaranteed by a whole-project build scope (every file as an entry point per query.ts), OR the output explicitly labels its scope; results are never silently under-reported.
- [ ] #5 Non-misleading: a cold/unbuildable graph degrades gracefully (never a false 'all clean'); scope is always stated.
- [ ] #6 Convention-free per ADR 004: detection uses only edges + reachability; no commands/queries CRUD logic (that lives in project_map's overlay).
- [ ] #7 Reuse only: missingTargets + orphans from the graph query API; no re-derivation in the supervisor.
- [ ] #8 TDD + comprehensive tests on a fixture with known broken refs + orphans (grouping, totals, scope label, graceful degradation); all suites + direct-tsc + format:check + frozen-lockfile green.
- [ ] #9 Docs: SUPERVISOR-GRAPH-INTEGRATION.md documents validate_project's contract and its place in the three-tool shape.
- [ ] #10 REPAIR ORDER: validate_project returns broken files in reverse-dependency (topological) order — a file's broken dependencies before the file — so the LLM fixes foundations first; independent broken files are a separate parallel bucket (no false sequence).
- [ ] #11 Repair order annotates each broken file with its dependents_count (fan-in / unblock impact) and its broken dependencies (what it sits above); highest-fan-in breaks ties among ready-to-fix files.
- [ ] #12 Dependency cycles among broken files are reported as 'fix-together' groups (never dropped or arbitrarily ordered without a note).
- [ ] #13 The topological ordering is a new query in platformos-graph (e.g. repairOrder over the induced broken-file subgraph), consumed by validate_project — no sort/graph logic re-implemented in the supervisor (ADR 003).
- [ ] #14 Repair order is framed as a STRUCTURAL suggestion (fix order to avoid repairing against a broken foundation), NOT a causal 'fixing X clears Y' claim; wording is non-misleading.
- [ ] #15 TDD: repairOrder graph query tested (linear chain, diamond/fan-in, cycle, disconnected/independent nodes) and validate_project's repair-order output tested on a fixture with interdependent broken files.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
REPAIR-ORDER (fix-ordering) — the actionable core of validate_project.

WHY. A flat list of broken files is the wrong deliverable for a repair loop. Bugs propagate UP the dependency edges: the ROOT CAUSE is downstream (the depended-on file), the SYMPTOMS appear upstream (its dependents). So the LLM must fix FOUNDATIONS BEFORE DEPENDENTS — otherwise it repairs a file against a still-broken dependency and has to redo it.

RULE. Order the broken files in REVERSE-DEPENDENCY (topological) order: a file's broken dependencies come before the file itself. (Edge A→B = "A depends on B" ⇒ emit B before A.) Example: get_user.graphql (broken) ← auth.liquid calls it ← page renders a partial that calls auth ⇒ repair order = get_user → auth → page.

REFINEMENTS:
1. Topological order, dependencies-first (foundations at the front).
2. FAN-IN priority as tie-breaker: among files with no remaining broken dependency, surface highest-fan-in first (a broken file 106 others depend on unblocks the most). Annotate each with dependents_count ("fix first — N files depend on it").
3. CYCLES: platformOS partials can form include cycles; a strict topo-sort fails on them. Report cyclic broken files as a "fix together" GROUP (do not drop or order arbitrarily without a note).

HONESTY (non-misleading): this is a STRUCTURAL ordering — "fix in this order so you don't repair against a broken foundation" — NOT a causal claim that fixing a dependency auto-clears its dependents (a dependent may have independent errors). Frame as *suggested order*.

SCOPE: order the SUBGRAPH of broken files (from missingTargets + the project lint pass) connected by dependency edges. Independent broken files carry no ordering constraint → present as parallel/any-order (a separate bucket), not forced into a false sequence.

GRAPH-SIDE (ADR 003 — structure logic lives in platformos-graph, not the supervisor):
- Add a query, e.g. `repairOrder(graph, brokenUris): { order: UriString[][] , cycles: UriString[][] }` (levels or a flat topo order + cycle groups), computed over the induced subgraph of brokenUris + dependency edges, reusing the existing edge model / dependenciesOf. validate_project consumes it and shapes output; it does NOT re-implement the sort.

OUTPUT (illustrative, bounded/grouped):
"repair_order": [
  { "file": "app/graphql/users/get_short.graphql", "errors": 2, "dependents": 106, "blocks": ["app/lib/functions/auth.liquid", ...] },
  { "file": "app/lib/functions/auth.liquid", "errors": 1, "dependents": 40, "depends_on_broken": ["app/graphql/users/get_short.graphql"] },
  ...
],
"repair_cycles": [ ["a.liquid","b.liquid"] ],       // fix-together groups
"independent": [ ... ]                               // broken files with no broken-dependency relationship
- Bounded/capped like the rest of the tool; totals given.
<!-- SECTION:PLAN:END -->
