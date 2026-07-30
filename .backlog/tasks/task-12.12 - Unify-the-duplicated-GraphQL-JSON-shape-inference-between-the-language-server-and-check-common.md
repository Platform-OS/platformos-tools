---
id: TASK-12.12
title: >-
  Unify the duplicated GraphQL/JSON shape inference between the language server
  and check-common
status: To Do
assignee: []
created_date: '2026-07-29 21:43'
labels:
  - architecture
  - check-common
  - language-server
  - duplication
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The same shape-inference logic exists twice: `platformos-language-server-common/src/PropertyShapeInference.ts` and `platformos-check-common/src/checks/unknown-property/property-shape.ts`. Both define `PropertyShape`, `LookupResult`, `mergeShapes`, `inferShapeFromJSON`, `inferShapeFromJSONString`, `unwrapType`, `isArrayType`, `selectionSetToShape` and `inferShapeFromGraphQL` — near-identical implementations of one concept.

Discovered while fixing the uncached `buildSchema` (TASK-12.1): the *same* defect was present in both copies and had to be fixed in both. That is the concrete cost of the duplication — a correctness or performance fix applied to one copy silently leaves the other wrong, and the two can drift in what they infer, which means the editor's hover/completions and the linter's `UnknownProperty` can disagree about the same code.

check-common is the natural owner: it is the deepest shared package, the LSP already depends on it (`PropertyShapeInference` imports `parseJSON`, `isError`, and now `buildGraphQLSchema` from it), and check-common is browser-safe so nothing about the LSP's runtime blocks reuse.

Care needed: the two copies are near-identical, not identical, and the differences are the whole risk. Before deleting either, diff them property by property and decide each divergence deliberately — the LSP copy carries an `ExpressionShapeResolver` callback and `inferShapeFromJsonLiteral` for AST-node literals that the check copy does not, so the shared surface must absorb those rather than drop them. This is a refactor with no intended behaviour change, so it needs the LSP's inference tests (hover, completion, TypeSystem) and check-common's `UnknownProperty` specs as the guard, both before and after.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The divergences between the two implementations are enumerated and each is resolved deliberately (absorbed into the shared version or documented as intentionally dropped) before any deletion
- [ ] #2 One implementation remains, owned by check-common, consumed by the language server
- [ ] #3 The LSP-only capabilities (`ExpressionShapeResolver`, `inferShapeFromJsonLiteral`) are preserved in the shared surface
- [ ] #4 No behaviour change: check-common `UnknownProperty` specs and the LSP hover/completion/TypeSystem suites pass unchanged, and whole-project offense output on a real project is byte-identical before/after
- [ ] #5 check-common stays browser-safe — no Node-only import is introduced by the move (verified by the browser package building and its suite passing)
<!-- AC:END -->
