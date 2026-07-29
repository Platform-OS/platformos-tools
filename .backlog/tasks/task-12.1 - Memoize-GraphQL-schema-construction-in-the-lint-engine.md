---
id: TASK-12.1
title: Memoize GraphQL schema construction in the lint engine
status: Done
assignee: []
created_date: '2026-07-29 03:51'
updated_date: '2026-07-29 04:37'
labels:
  - performance
  - check-common
dependencies: []
modified_files:
  - packages/platformos-check-common/src/utils/graphql-schema.ts
  - packages/platformos-check-common/src/utils/graphql-schema.spec.ts
  - packages/platformos-check-common/src/checks/graphql/index.ts
  - >-
    packages/platformos-check-common/src/checks/unknown-property/property-shape.ts
  - packages/platformos-check-common/src/index.ts
  - packages/platformos-language-server-common/src/PropertyShapeInference.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`buildSchema()` is called on the platformOS GraphQL SDL (303 KB) with no caching, and costs 46–86 ms per call:

- `checks/graphql/index.ts` — once per `.graphql` file in the project (46 files in pos-module-mcp → 3363 ms)
- `checks/unknown-property/property-shape.ts` — once per `{% graphql %}` tag site across all liquid files (→ most of 4403 ms)

The SDL is a process constant supplied by the docset, so the built schema is a pure function of the SDL string. A cache keyed on that string removes ~7 s per lint run on a real project and also cuts GC pressure, since each call currently allocates and discards a full schema.

Memory constraint: the cache must hold at most one schema (the SDL does not vary within a process). Do not build an unbounded map.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Both call sites obtain the schema through one shared memoized helper instead of calling `buildSchema` directly
- [x] #2 Repeated lint runs over a project with many GraphQL files build the schema exactly once per distinct SDL string
- [x] #3 The cache retains at most one built schema at a time
- [x] #4 A malformed SDL still degrades exactly as before (GraphQLCheck reports nothing, UnknownProperty continues without schema-based inference) and the failure is not cached as a success
- [x] #5 Offenses reported by GraphQLCheck and UnknownProperty are unchanged, verified by the existing check specs plus a test asserting the memoization
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `buildGraphQLSchema(sdl)` in `check-common/src/utils/graphql-schema.ts`: a single-entry cache keyed on the SDL string, exported from the package index. Both check call sites now go through it (`checks/graphql/index.ts`, `checks/unknown-property/property-shape.ts`).

Also swapped the language server's own duplicate call site (`PropertyShapeInference.ts`) onto the shared helper — same defect (a schema rebuilt per invocation inside a long-lived process), one-line change, so editor hover/completion latency benefits too. The LSP's `GraphQLFieldHoverProvider` / `GraphQLFieldCompletionProvider` already had their own `schemaCache` and were left alone.

Failures are deliberately not cached: a malformed SDL throws on every call exactly as before, so `GraphQLCheck` still surfaces it through the run's error handler and `inferShapeFromGraphQL` still degrades to schema-less inference. Only one schema is retained; alternating SDLs rebuild rather than accumulate (pinned by a test).

Measured on pos-module-mcp (46 graphql files): GraphQLCheck 3325 ms → negligible, UnknownProperty 4311 ms → mostly gone. Whole-project `check()` 21284 ms → 7294 ms together with TASK-12.2, with byte-identical offenses on three real projects.
<!-- SECTION:FINAL_SUMMARY:END -->
