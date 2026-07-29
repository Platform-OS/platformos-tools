---
id: TASK-9.18
title: >-
  Graph-driven cross-file autofixes (did-you-mean, rename/move propagation,
  signature-arg propagation, safe dead-code deletion, repair-ordering)
status: To Do
assignee: []
created_date: '2026-07-02 15:01'
labels:
  - platformos-graph
  - mcp-supervisor
  - fixes
  - autofix
dependencies:
  - TASK-9.10
  - TASK-8.6
references:
  - packages/platformos-graph/src/graph/query.ts
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. Per-file lint fixes (TASK-8.6/8.3) are forward-looking and single-file. The graph is the ONLY source of CROSS-FILE reference knowledge, so it enables a class of fixes lint structurally cannot produce — the fix-side counterpart to blast radius. All the primitives already exist: `nearestModules` (Levenshtein over same-category modules), `dependentsOf` (incoming edges, each carrying the exact call-site `source.range`), `orphans`, `missingTargets`, and the topological repair-order (TASK-9.12).

WHAT — five fix classes, each graph-derived, each producing precise text-edits (edges carry `source.range`, so edits target the exact call site):
 1. GRAPH-BACKED "did you mean?" — for `MissingPartial`/`MissingAsset`/`MissingGraphql`/missing `layout`, `nearestModules(target)` yields the closest REAL project module of the same category → a concrete replace-edit at the call-site range (`{% render 'crad' %}` → `'card'`). Stronger than a heuristic string match because candidates are the actual on-disk modules. (Supersedes/feeds TASK-8.3's did-you-mean, which is not graph-backed.)
 2. RENAME / MOVE propagation — given a rename `A → B`, `dependentsOf(A)` gives every caller + its `source.range` → one text-edit per caller updating the reference. A true multi-file refactor lint cannot do.
 3. SIGNATURE-ARG propagation — `signature_risk` (TASK-9.10) already identifies callers missing a required `@param` / passing an undeclared one, per call site → insert the missing arg / drop the stray one at each caller.
 4. SAFE dead-code deletion — `orphans` proves zero incoming references; because the graph is NEVER-STALE, that `0` is trustworthy enough to offer "delete this file".
 5. REPAIR-ORDERING — apply cross-file fixes in topological (dependencies-first) order (shared with TASK-9.12) so a batch of fixes does not thrash / re-break.

SAFETY (load-bearing — these WRITE across many files):
 - Never-stale is critical: a stale graph proposing a rename across 90 callers would be catastrophic. These fixes MUST gate on a fresh graph (reuse the GraphCache freshness contract) and refuse/degrade when `impact.status !== 'computed'`.
 - The graph only tracks STATICALLY-resolvable references (dynamic `{% render some_var %}` is skipped by design). A rename/propagation fix MUST surface that dynamic references are NOT covered, so the agent knows the edit set may be incomplete.
 - Edits are proposed (agent-applied), consistent with the existing `AgentFix`/`proposed_fixes` contract; the supervisor never writes files itself.

ARCHITECTURE (ADR 003). The graph traversal/candidate logic lives in platformos-graph (extend the query API if needed — e.g. a rename-impact helper); the supervisor shapes the results into `AgentFix`/`proposed_fixes`. No graph logic in the supervisor.

Working dir: ~/Work/platformos-tools/platformos-tools. Likely splits into per-class sub-tasks; scope the design first, then land class 1 (did-you-mean) as the highest-value / lowest-risk slice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Graph-backed did-you-mean: a missing render/asset/graphql/layout target yields a replace-edit to the nearest REAL same-category module (via nearestModules) at the exact call-site range
- [ ] #2 Rename/move propagation: given a rename, every caller (dependentsOf) gets a precise text-edit at its source.range; dynamic (non-statically-resolvable) references are explicitly reported as NOT covered
- [ ] #3 Signature-arg propagation: signature_risk callers get insert-missing-arg / remove-unexpected-arg edits at their call sites
- [ ] #4 Safe dead-code deletion offered only for graph-proven orphans on a FRESH graph (never-stale gated)
- [ ] #5 Cross-file fix batches are emitted in topological repair-order (dependencies first), shared with TASK-9.12
- [ ] #6 All graph traversal/candidate logic lives in platformos-graph (ADR 003); the supervisor only shapes AgentFix/proposed_fixes and never writes files
- [ ] #7 Fixes gate on a fresh graph (impact.status === 'computed') and degrade safely otherwise; graph + supervisor suites + type-check + format green
<!-- AC:END -->
