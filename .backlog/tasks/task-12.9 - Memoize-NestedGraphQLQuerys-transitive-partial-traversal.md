---
id: TASK-12.9
title: Memoize NestedGraphQLQuery's transitive partial traversal
status: To Do
assignee: []
created_date: '2026-07-29 21:42'
labels:
  - performance
  - check-common
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`NestedGraphQLQuery` costs **1073 ms** of a whole-project run on pos-module-mcp — the fourth-largest check, and the last instance of the recompute pattern already fixed in TASK-12.1 (GraphQL schema) and TASK-12.2 (partial param analysis).

`containsGraphQLTransitively` (`checks/nested-graphql-query/index.ts`) walks the render/function chain from each call site: for every partial it resolves the target, reads it, and calls `toLiquidHtmlAST(source)`, then recurses. The `visited` set only prevents cycles WITHIN one call site's walk — nothing is shared across call sites or across lint runs, so a partial reachable from many callers is re-read and re-parsed once per caller, and again on the next run.

Verified untouched on this branch: `grep -c "createBoundedCache|memo"` in that check returns 0.

The reusable primitive already exists: `createBoundedCache` (check-common `utils/bounded-cache.ts`), used by TASK-12.2. What to cache is the per-source "found nodes" result of `findNodesInAST` — a small array of `{ type, partialName }` / `{ type: 'graphql' }` records — NOT the AST, so memory stays flat. Key on content exactly as TASK-12.2 does, which makes the entry self-invalidating: an edited partial is simply a different key.

Note the payoff is mostly for whole-project consumers (CLI, `validate_project`) since TASK-12.3 already scopes `validate_code` to one file's call sites — worth stating so the measurement is taken on the right workload rather than on a single-buffer lint, where it will look like nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A partial's node scan is computed once per distinct source content, not once per call site — asserted with a parser spy
- [ ] #2 Only the small found-node result is cached; no AST or parsed node is retained
- [ ] #3 Cache is bounded with a documented limit and content-keyed, so an edited partial is never served stale (covered by a test)
- [ ] #4 NestedGraphQLQuery offenses are unchanged: existing specs pass, plus whole-project offense output on a real project is byte-identical before/after
- [ ] #5 Whole-project check time on pos-module-mcp measured and recorded before/after (the workload where this check's cost actually appears)
<!-- AC:END -->
