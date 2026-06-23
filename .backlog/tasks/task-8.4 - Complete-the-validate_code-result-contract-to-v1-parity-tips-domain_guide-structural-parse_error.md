---
id: TASK-8.4
title: >-
  Complete the validate_code result contract to v1 parity (tips, domain_guide,
  structural, parse_error)
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
updated_date: '2026-06-23 10:33'
labels: []
dependencies:
  - TASK-8.2
  - TASK-8.3
  - TASK-9.2
  - TASK-9.3
references:
  - packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md
  - docs/mcp-supervisor/salvage/OLD-parity-spec.ts
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-8
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Extend the `ValidateCodeResult` envelope (assembled in result/, task-7.9) with the four LLM-facing fields the minimal TASK-7 rebuild does not emit but v1 does: `tips`, `domain_guide`, `structural`, and `parse_error`. Each is an order-independent pure transform feeding the typed result.

## Why
The v1 contract (`CURRENT_SYSTEM_ARCHITECTURE.md` §5.13 / §6; confirmed in the compiled `dist/` — `structural` used 30x, `tips` 15x, `domain_guide` 4x, `parse_error` 1x) has 13 result fields. TASK-7.9 assembles only status / must_fix_before_write / errors / warnings / infos / proposed_fixes / clusters / scorecard / next_step. Leaving these four out silently shrinks the JSON the agent consumes.

## Scope (each a pure transform; document any genuine ordering)
- `structural`: the file-level AST snapshot (slug, layout, method, renders_used, graphql refs, filters_used, tags_used, translation_keys, doc_params). Produced from the AST already parsed on the request path; expose as `ValidateCodeStructuralSnapshot`.
- `parse_error`: the tolerant-parse failure string (null when parse succeeds). The linter still surfaces the underlying syntax error as a diagnostic; this is the separate top-level signal.
- `tips`: the content-trigger advisories from task-8.2 wired into the result (full mode); advisory only — never affects `must_fix_before_write`.
- `domain_guide`: the triggered-gotcha bundle from task-8.2 wired into the result (full mode).
- Feed `domain` + gotcha signal into the scorecard transform so it is domain-aware (matches v1 `generateScorecard(structural, domain, ...)`).

## Constraints
- Transforms stay pure and order-independent (task-7.9 contract). All inputs (AST, structural, domain bundle, content-trigger tips) are produced upstream and passed in.
- `quick` mode behaviour for these fields matches v1: tips / domain_guide are full-mode only; structural / parse_error are emitted in both modes.

## Out of scope
- Producing the gotcha/tip data and domain logic (task-8.2).
- Rule-library enrichment (task-8.3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ValidateCodeResult emits structural (full AST snapshot) and parse_error (null on success) in both quick and full modes, with unit pins
- [ ] #2 tips and domain_guide are emitted in full mode (and omitted/empty in quick, matching v1); tips never affect must_fix_before_write
- [ ] #3 The scorecard transform is domain-aware (consumes domain + gotcha signal) as in v1
- [ ] #4 Each new field is produced by an independent pure transform; any genuinely required ordering is documented with rationale (task-7.9 contract)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Reframe (2026-06-23, ADR 003) — `structural` is CONSUMED from platformos-graph, not computed here

The `structural` result field has two parts, both SOURCED FROM `platformos-graph` (the supervisor only shapes them into `ValidateCodeResult`):
- Cross-file / project-relationship: `rendered_by` (dependents), `is_orphan`, missing render/function/graphql targets, and (optionally) resource/CRUD completeness — from the graph query API (TASK-9.2).
- Self-structural: `renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`, `layout`, `method` — from per-module self-structural (TASK-9.3).

The supervisor adds NO graph/extraction logic; it consumes the graph API and assembles the field (pure). This is the agent-facing 'dependencies in the project' view the v1 tool provided. Now depends on TASK-9.2 + TASK-9.3.
<!-- SECTION:NOTES:END -->
