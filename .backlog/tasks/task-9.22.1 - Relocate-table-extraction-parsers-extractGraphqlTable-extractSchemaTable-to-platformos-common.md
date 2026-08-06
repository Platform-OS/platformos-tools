---
id: TASK-9.22.1
title: >-
  Relocate table-extraction parsers (extractGraphqlTable, extractSchemaTable) to
  platformos-common
status: Done
assignee: []
created_date: '2026-07-07 10:13'
updated_date: '2026-07-07 10:25'
labels:
  - refactor
  - platformos-common
  - platformos-check-common
dependencies: []
modified_files:
  - packages/platformos-common/src/graphql-table.ts
  - packages/platformos-common/src/graphql-table.spec.ts
  - packages/platformos-common/src/schema-table.ts
  - packages/platformos-common/src/schema-table.spec.ts
  - packages/platformos-common/src/index.ts
  - packages/platformos-common/package.json
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/incremental.ts
parent_task_id: TASK-9.22
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`extractGraphqlTable` (graphql-table.ts) and `extractSchemaTable` (schema-table.ts) currently live in `platformos-check-common` and are re-exported from its index. They parse neutral platformOS platform facts (a GraphQL op's target model table; a schema file's `name:`) and are NOT used by any lint check — their only consumer is `platformos-graph` (traverse.ts, incremental.ts). Per the division-of-responsibility rule, structural/platform-fact parsers belong in `platformos-common` (which already owns frontmatter, RouteTable, DocumentsLocator and already depends on js-yaml).

Pure relocation — NO behavior change in this task (the array-shape change is TASK follow-up). Add the `graphql` dependency to platformos-common's package.json (schema-table's js-yaml is already present). Update platformos-graph to import both from `@platformos/platformos-common`. Remove the re-exports from platformos-check-common's index. Move the spec files alongside the impls.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 graphql-table.ts + schema-table.ts (and their .spec.ts) live under packages/platformos-common/src and are exported from platformos-common's index
- [x] #2 platformos-common package.json declares a graphql dependency; yarn.lock churn is limited to that addition
- [x] #3 platformos-check-common no longer exports extractGraphqlTable/extractSchemaTable; no remaining importer references them from check-common
- [x] #4 platformos-graph imports both extractors from @platformos/platformos-common
- [x] #5 type-check, tests, and format:check pass for platformos-common, platformos-check-common, and platformos-graph
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Relocated the two platform-fact parsers `extractGraphqlTable` (graphql-table.ts) and `extractSchemaTable` (schema-table.ts), with their specs, from `platformos-check-common` to `platformos-common` — they parse neutral platformOS structure facts (a GraphQL op's target table; a schema's `name:`) with no lint/offense use, so they belong beside frontmatter/RouteTable/DocumentsLocator. Pure relocation, no behavior change (array-shape widening is TASK-9.22.4).

Changes:
- git mv of graphql-table.{ts,spec.ts} + schema-table.{ts,spec.ts} into platformos-common/src (history preserved).
- platformos-common: added `export *` for both from src/index.ts; added `graphql: ^16.12.0` to package.json deps (browser-safe, isomorphic — respects common's no-node-imports invariant; js-yaml already present for schema-table).
- platformos-check-common: removed both re-exports from src/index.ts (kept levenshtein + isTranslationKeyUsage, which are lint-adjacent and stay).
- platformos-graph: traverse.ts + incremental.ts now import both extractors from @platformos/platformos-common (split from the check-common import; isTranslationKeyUsage/path/UriString/etc stay from check-common).

Verification: common build + check-common build + graph build (tsc -b) clean; graph direct tsc --noEmit clean; common tests 284 (incl. moved 13 + 10), graph tests 101, check-common tests 1034 (was 1057; −23 = the two moved specs, confirming a lossless move); prettier --check on all touched files clean; yarn install --frozen-lockfile passes with ZERO yarn.lock churn (existing graphql@^16.12.0 entry already satisfies common). dist/ regenerated for the three packages by the builds (committed artifacts per repo convention).
<!-- SECTION:FINAL_SUMMARY:END -->
