---
id: TASK-8.4
title: >-
  Complete the validate_code result contract to v1 parity (tips, domain_guide,
  structural, parse_error)
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
updated_date: '2026-08-07 14:48'
labels: []
dependencies:
  - TASK-8.2
  - TASK-8.3
references:
  - packages/platformos-mcp-supervisor/CURRENT_SYSTEM_ARCHITECTURE.md
  - docs/mcp-supervisor/salvage/OLD-parity-spec.ts
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-8
priority: medium
ordinal: 19000
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
## STALENESS CHECK 2026-08-07 — these fields were REMOVED, not never-added

The task reads as "fill in fields the contract already has". It is now the opposite: all
four were present as always-empty stubs and were **deliberately deleted** by TASK-12.5
(archived, Done), alongside `proposed_fixes` and `clusters`/`scorecard`, on the grounds
that "an agent cannot distinguish an always-empty field from a meaningful one, so
`proposed_fixes: []` was a standing invitation to conclude 'no fixes are available' from
a field that was never going to say anything else". A clean-file result went from 15 keys
to 6.

Current `ValidateCodeResult`: `status`, `must_fix_before_write`, `errors`, `warnings`,
`infos`, `impact`, plus optional `next_step`, `not_applicable_reason`, `truncated`. None
of `tips`, `domain_guide`, `structural`, `parse_error` exists.

**Two consequences for whoever picks this up:**

1. `assemble.spec.ts` pins the EXACT key set and asserts each removed field is ABSENT,
   including a JSON round trip (because `undefined` disappears on the wire, so "absent"
   and "present but undefined" are indistinguishable to a naive test yet identical to an
   agent). Re-adding a field means updating that guard **deliberately**, not deleting it.
2. TASK-12.5's rule stands: a field ships only once something populates it. So this task
   cannot land ahead of TASK-8.2/8.3 — re-adding empty fields would restore exactly the
   defect that removal fixed.
<!-- SECTION:NOTES:END -->
