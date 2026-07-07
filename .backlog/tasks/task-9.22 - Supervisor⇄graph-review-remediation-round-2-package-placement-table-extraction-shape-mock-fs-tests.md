---
id: TASK-9.22
title: >-
  Supervisor⇄graph review remediation (round 2): package placement,
  table-extraction shape, mock-fs tests
status: Done
assignee: []
created_date: '2026-07-07 10:12'
updated_date: '2026-07-07 10:53'
labels:
  - code-review
  - platformos-graph
  - platformos-common
  - refactor
dependencies: []
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella for the second-round supervisor review of the `supervisor-graph-integration` branch (first round was TASK-9.8). The supervisor flagged division-of-responsibility and test-hygiene defects. Each child is an independently reviewable PR. See SUPERVISOR-GRAPH-INTEGRATION.md for branch context.

Defects raised:
1. Table-extraction parsers (`extractGraphqlTable`, `extractSchemaTable`) live in `platformos-check-common` but are platform-fact/structural parsers with no lint (offense) use — they belong in `platformos-common` alongside frontmatter/route-table/documents-locator. (User decision: move BOTH.)
2. `extractGraphqlTable` returns only the FIRST table and a scalar; it must return ALL declared tables as an array, and must also cover `record_create`/mutation table declarations.
3. New graph specs (`incremental.spec.ts`, `deserialize.spec.ts`) write real temp files via `mkdtemp`/`NodeFileSystem` instead of the in-memory `MockFileSystem`; and use `[...].join('\n')` line-arrays instead of template literals.
4. `AppCache` (platformos-check-node): confirmed NOT duplicating any existing mechanism (LSP DocumentManager/AppGraphManager are different runtime/concern); keep it where it is and document why it exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All four child tasks are Done
- [x] #2 yarn build, yarn type-check, yarn test, yarn format:check are green across affected packages
- [x] #3 No behavioral change to validate_code output beyond the intended table-shape widening
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All four children Done. Second-round supervisor review remediation for the supervisor-graph-integration branch complete.

- 9.22.1 — relocated extractGraphqlTable + extractSchemaTable (impl + specs) from check-common → platformos-common (structure/platform facts belong with frontmatter/RouteTable/DocumentsLocator); added browser-safe graphql dep to common; graph imports from common. Lossless move (check-common 1057→1034, common +23).
- 9.22.4 — widened extractGraphqlTable → extractGraphqlTables: string[] (all distinct tables, document order, record_create/mutation covered, dedup). GraphQLModule.table → tables: string[] (required, always-present); SchemaModule stays scalar. Factory + deserialize seed tables:[]; write-sites + specs updated. Blast radius confined to graph (no supervisor/LSP/serialize reads).
- 9.22.2 — converted incremental.spec + deserialize.spec to in-memory MockFileSystem (backing-object mutation for add/modify/delete) + template literals; all 17 scenarios preserved, faster, no disk I/O.
- 9.22.3 — documented AppCache PLACEMENT rationale (JSDoc): why check-node (getApp globs disk, Node-only), and that no pre-existing mechanism duplicates it (LSP DocumentManager / supervisor GraphCache are different runtimes/payloads). No code moved.

Final consolidated verification (all green): builds clean (common/check-common/graph/check-node via tsc -b); direct type-checks clean (graph, check-node, supervisor tsc exit 0); tests — common 286, check-common 1034, graph 101, check-node app-cache 6, supervisor 76 (validate_code blast-radius unchanged → AC#3); repo-wide yarn format:check clean; yarn install --frozen-lockfile exit 0 with ZERO yarn.lock churn. dist/ regenerated for the touched packages (committed-artifact convention).

Not committed — left in working tree for review. One deliberate non-edit flagged for a round-2 doc pass: SUPERVISOR-GRAPH-INTEGRATION.md §2.2 (GraphQLModule shape) and §6 doubt #4 now describe pre-9.22.4 behavior.
<!-- SECTION:FINAL_SUMMARY:END -->
