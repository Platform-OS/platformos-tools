---
id: TASK-8.4
title: >-
  Complete the validate_code result contract to v1 parity (tips, domain_guide,
  structural, parse_error)
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
updated_date: '2026-08-01 21:12'
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
- `tips`: the content-trigger advisories from task-8.2 wired into the result; advisory only — never affects `must_fix_before_write`.
- `domain_guide`: the triggered-gotcha bundle from task-8.2 wired into the result.
- Feed `domain` + gotcha signal into the scorecard transform so it is domain-aware (matches v1 `generateScorecard(structural, domain, ...)`).

## Also in scope: a first-class "not checked" outcome

`lintBuffer` distinguishes `checked` from `excluded-by-config`, `not-an-app-file` and
`not-a-source-file` (TASK-12.24), because an empty result otherwise reads as "this
file is fine". The handler currently carries that up as PROSE in `next_step`, which
an agent has to read rather than branch on, while `status` still says `ok`.

The contract should say it in a field: either a `ValidateCodeStatus` value of its own
or a `not_checked: { reason }`. Whichever, `must_fix_before_write` stays `false` —
nothing was found, so nothing blocks a write — and the reason must survive into the
v1-parity baselines as an intentional diff (TASK-8.5), since v1 had no such concept.

## Constraints
- Transforms stay pure and order-independent (task-7.9 contract). All inputs (AST, structural, domain bundle, content-trigger tips) are produced upstream and passed in.
- There are no modes to gate these fields on. v1 emitted `tips` / `domain_guide` in
  `full` only; `mode` was removed on 2026-08-01 (TASK-12.5), so every call gets every
  field. If a field turns out to be too expensive for a per-write call, that is an
  argument for making it cheaper or for a new input — not for reviving a depth knob
  whose one real distinction no longer exists.

## Out of scope
- Producing the gotcha/tip data and domain logic (task-8.2).
- Rule-library enrichment (task-8.3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The scorecard transform is domain-aware (consumes domain + gotcha signal) as in v1
- [ ] #2 Each new field is produced by an independent pure transform; any genuinely required ordering is documented with rationale (task-7.9 contract)
- [ ] #3 tips and domain_guide are emitted on every call, and tips never affect must_fix_before_write
- [ ] #4 ValidateCodeResult emits structural (full AST snapshot) and parse_error (null on success) on every call, with unit pins
- [ ] #5 A file that was not checked is distinguishable from a clean one by a FIELD, not only by next_step prose, and must_fix_before_write stays false
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Reframe (2026-06-23, ADR 003) — `structural` is CONSUMED from platformos-graph, not computed here

The `structural` result field has two parts, both SOURCED FROM `platformos-graph` (the supervisor only shapes them into `ValidateCodeResult`):
- Cross-file / project-relationship: `rendered_by` (dependents), `is_orphan`, missing render/function/graphql targets, and (optionally) resource/CRUD completeness — from the graph query API (TASK-9.2).
- Self-structural: `renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`, `layout`, `method` — from per-module self-structural (TASK-9.3).

The supervisor adds NO graph/extraction logic; it consumes the graph API and assembles the field (pure). This is the agent-facing 'dependencies in the project' view the v1 tool provided. Now depends on TASK-9.2 + TASK-9.3.
<!-- SECTION:NOTES:END -->
