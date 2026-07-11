---
id: TASK-9.11
title: project_map tool — graph-backed discovery + resource overlay (orientation)
status: To Do
assignee: []
created_date: '2026-07-01 21:14'
labels:
  - mcp-supervisor
  - platformos-graph
  - discovery
  - tool
dependencies:
  - TASK-9.7
  - TASK-9.10
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
  - packages/platformos-graph/src/graph/query.ts
  - SUPERVISOR-GRAPH-INTEGRATION.md
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The #1 failure mode of an LLM generating code in a real platformOS project is not bad syntax — it is NOT KNOWING WHAT ALREADY EXISTS: it reinvents a query/command that exists, hallucinates a partial, or writes against a table it doesn't understand. Grounding the model in "what exists and how it connects" BEFORE it writes prevents more bad code than any post-hoc validation. This is the graph's highest-leverage use for code generation, and it is a discovery/query capability — NOT a validator and NOT part of validate_code.

WHAT. A read-only `project_map` MCP tool that turns the cached project graph (+ the commands/queries resource overlay) into a COMPACT, agent-actionable map used at task start. It leads with what the graph adds over `ls`+grep — RESOLVED cross-file relationships (through platformOS module/lib/extension resolution and `{% liquid %}` blocks that defeat grep) and RESOURCE COMPLETENESS — not a raw file tree.

CONTENT (what the map surfaces):
- Entry points + counts by kind (pages, layouts, partials, lib commands/queries, graphql ops, schemas/tables) — a size/shape overview.
- RESOURCE OVERLAY (the headline; this is the TASK-9.7 convention overlay consumed here): per model table, the schema + the commands/queries/graphql ops that operate on it, and CRUD completeness (e.g. "event_report: has search+create, MISSING update/delete"). This is the single most useful discovery signal for "is there already a way to do X, and what's missing."
- Resolved relationships, queryable via drill-down (see below): "what renders/includes X", "what calls query Y", "what graphql ops hit table Z".

HARD RULES (utilize the graph correctly):
- NEVER dump the graph. The whole-project serialization is ~345k tokens on the real project — useless as an LLM input. project_map returns a bounded SUMMARY by default and supports DRILL-DOWN parameters for slices (e.g. { table? , renders_of? , calls_of? , kind? , path_prefix? }) so the agent pulls only what it needs.
- Lead with graph-unique content (resolved relationships + resource completeness). A plain file listing is something the LLM can get itself — do not pad the response with it.
- REUSE, do not re-derive: consume buildAppGraph + the query API (dependenciesOf/dependentsOf/nearestModules) + the TASK-9.7 resource overlay. The supervisor owns only tool wiring + output shaping (ADR 003/004 consumer principle). Commands/queries are a `core`-module CONVENTION (ADR 004), so the overlay must be convention-scoped/configurable, not baked into the graph.
- Built on the cached graph from TASK-9.10 (do not rebuild per call).

Distinct from the other two tools: project_map = DISCOVERY (task start, "what exists / how connected"); validate_code blast-radius = CHANGE SAFETY (edit time, "what breaks if I touch this"); validate_project = HEALTH (task end, "is anything broken/dead").

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A read-only `project_map` MCP tool is registered on both transports (stdio + HTTP) alongside validate_code, returning a structured, token-BOUNDED map (never the raw graph dump).
- [ ] #2 Summary mode returns counts by kind (pages/layouts/partials/lib/graphql/schemas) + entry points — a shape overview, not a file tree.
- [ ] #3 Resource overlay: for each model table, the schema + its commands/queries/graphql ops + CRUD completeness (present vs missing operations). Convention-scoped/configurable per ADR 004 (disable-able for non-core apps).
- [ ] #4 Drill-down parameters return relationship slices (e.g. what-renders-X / callers-of-query-Y / graphql-ops-on-table-Z / files-under-prefix) via the graph query API — each response bounded and agent-actionable.
- [ ] #5 Leads with graph-unique content (resolved relationships + resource completeness); does not pad with a plain file listing the LLM could produce itself.
- [ ] #6 Reuse only: buildAppGraph + query API + the TASK-9.7 resource overlay; zero graph/scanner logic re-implemented in the supervisor.
- [ ] #7 Built on the TASK-9.10 cached graph (verified: does not trigger a full rebuild per call).
- [ ] #8 TDD + comprehensive tests on a fixture project (summary, resource overlay incl. a missing-CRUD case, each drill-down, token bound); all suites + direct-tsc + format:check + frozen-lockfile green.
- [ ] #9 Docs: SUPERVISOR-GRAPH-INTEGRATION.md documents the three-tool shape (project_map / validate_code blast-radius / validate_project) and project_map's contract.
<!-- AC:END -->
