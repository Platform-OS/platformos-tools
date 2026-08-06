---
id: TASK-9.22.4
title: >-
  extractGraphqlTable returns ALL declared tables (array) and covers
  record_create/mutation tables
status: Done
assignee: []
created_date: '2026-07-07 10:13'
updated_date: '2026-07-07 10:38'
labels:
  - platformos-common
  - platformos-graph
dependencies:
  - TASK-9.22.1
modified_files:
  - packages/platformos-common/src/graphql-table.ts
  - packages/platformos-common/src/graphql-table.spec.ts
  - packages/platformos-common/src/schema-table.ts
  - packages/platformos-graph/src/types.ts
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/incremental.ts
  - packages/platformos-graph/src/graph/deserialize.ts
  - packages/platformos-graph/src/graph/traverse-edges.spec.ts
  - packages/platformos-graph/src/graph/incremental.spec.ts
parent_task_id: TASK-9.22
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`extractGraphqlTable` currently short-circuits on the first `table` field ("first table wins") and returns `string | undefined`. A single GraphQL document can target multiple tables (multiple `records(...)` blocks, aliased queries, and `record_create`/mutation inputs). It must return every distinct declared string table in document order as `string[]` (empty array when none). Mutation/`record_create` table inputs already parse via the generic ObjectField visitor — verify and pin them; the change is dropping the first-wins short-circuit and collecting all.

Ripple: `GraphQLModule.table?: string` in platformos-graph/src/types.ts becomes `tables: string[]`; update the write sites (traverse.ts:91, incremental.ts:210) and every spec that reads `.table` on a GraphQL module (incremental.spec.ts:181, extract/structural/build specs as applicable). `.table` is not serialized and not read by supervisor/impact logic, so blast radius is confined to graph write-sites + specs. `extractSchemaTable` stays scalar (a schema file declares exactly one `name:`); keep SchemaModule.table as-is.

Depends on TASK-9.22.1 (file now lives in platformos-common).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 extractGraphqlTable returns string[] of all distinct declared tables in document order (empty array when none/unparseable)
- [x] #2 record_create / mutation table inputs are covered by a test asserting the full array
- [x] #3 A multi-table document test asserts every table is returned (not just the first)
- [x] #4 GraphQLModule exposes tables: string[]; all graph write-sites and specs updated; extractSchemaTable/SchemaModule remain scalar
- [x] #5 type-check, tests, and format:check pass for platformos-common and platformos-graph
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Widened GraphQL table extraction from "first table, scalar" to "all distinct tables, array", and rippled the type through the graph.

Parser (platformos-common):
- Renamed `extractGraphqlTable` → `extractGraphqlTables`, return type `string | undefined` → `string[]`. Dropped the `first table wins` short-circuit; now collects every distinct string table in document order (dedup via first-occurrence). Empty array for none / dynamic (non-string) / unparseable. record_create / mutation table inputs were already covered by the generic ObjectField visitor — now pinned by tests, including a mixed query+mutation document asserting the full ordered array. Spec rewritten to the array contract (15 tests: +dedup, +mixed-mutation).

Graph ripple:
- `GraphQLModule.table?: string` → `tables: string[]` (required, always-present; empty = no table declared — matches the "usage arrays always present" convention). SchemaModule.table stays scalar (a schema declares exactly one `name:`); JSDoc cross-links updated.
- `getGraphQLModuleByUri` factory initializes `tables: []`; `deserialize` reconstructs GraphQL nodes with `tables: []` (a re-derived leaf fact, not serialized — the fingerprint-driven incremental reconcile re-reads it).
- Write-sites traverse.ts + incremental.ts assign `module.tables = extractGraphqlTables(...)`; their comments corrected to reference platformos-common (post-9.22.1) instead of check-common.
- Specs updated: traverse-edges.spec `graphqlNode` helper + inline factory assertion + the two table assertions (`toBe`/`toBeUndefined` → `toEqual([...])`/`toEqual([])`); incremental.spec table-fact comparison → `.tables`.

Blast radius stayed confined to graph write-sites + specs: confirmed no supervisor/LSP code reads `.table`/`.tables`, and `tables` is excluded from serialization (SerializableNode unchanged), so the persisted cache and all equivalence tests are unaffected.

Verification: graph type-check clean (direct tsc — TDD caught the required-field ripple in deserialize.ts and two inline spec assertions, all fixed); supervisor type-check clean (exit 0); common tests 286 (was 284; +2 new parser cases), graph tests 101, prettier clean on all touched files.

NOTE flagged to user (not edited): SUPERVISOR-GRAPH-INTEGRATION.md §2.2 model shape (`GraphQLModule { table?: string }`) and §6 doubt #4 ("resolves to the first/none") now describe superseded behavior — a doc-accuracy follow-up, deliberately left for the round-2 doc pass.
<!-- SECTION:FINAL_SUMMARY:END -->
