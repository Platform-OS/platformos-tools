---
id: TASK-8.6
title: >-
  Translate structured Offense.fix / suggest into validate_code proposed_fixes +
  diagnostic.fix (minimal fix passthrough)
status: To Do
assignee: []
created_date: '2026-07-02 15:00'
labels:
  - mcp-supervisor
  - fixes
  - ergonomics
dependencies:
  - TASK-8.1
references:
  - packages/platformos-mcp-supervisor/src/lint/lint.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
parent_task_id: TASK-8
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. The check-common engine ALREADY computes structured fixes (`Offense.fix` — `FixDescription` text-edits/inserts — and `Offense.suggest`), but the current supervisor slice DROPS them: `assemble.ts` hardcodes `proposed_fixes: []`, and `lint.ts` `toDiagnostic` maps only check/severity/message/range (its own doc: "the structured `Offense.fix` / `suggest` are intentionally not translated"). So `validate_code` today returns detection but ZERO fixes. This wires the fixes the engine already produces through to the agent — no edit text is ever regenerated.

RELATIONSHIP TO TASK-8.3. TASK-8.3 ("port the v1 rule library … hints, variants, did-you-mean, confidence, fixes") is the BROAD enrichment port. This task is the MINIMAL, independently-shippable slice: just faithfully pass through the structured fixes check-common already emits. It can land before the full rule library; 8.3's hints/variants/confidence layer on top. (Graph-BACKED did-you-mean + cross-file fixes are a separate task under TASK-9 — see the graph-driven autofix task.)

WHAT.
 - `lint.ts`: translate `Offense.fix` (FixDescription) → the `AgentFix` shape (`text_edit` | `insert` | `guidance`) on `ValidateCodeDiagnostic.fix`, and `Offense.suggest` → `diagnostic.suggestion`. Preserve check-common's offsets faithfully into the `AgentFix` 0-based `start_index`/`end_index` contract (mind that diagnostics use 1-based line/col but `AgentFix` uses 0-based offsets — the two must not be conflated).
 - `assemble.ts`: populate top-level `proposed_fixes: ProposedFix[]` from the per-diagnostic fixes (carrying the originating `check`), instead of `[]`.
 - Keep the "supervisor never regenerates edit text from scratch" invariant (types.ts) — translate, don't synthesize.

TESTS. Whole-value result assertions (CLAUDE.md): a check that emits a text-edit fix → the exact `AgentFix` appears on the diagnostic AND in `proposed_fixes` with its `check`; a check with only a `suggest` → `suggestion` set, no machine fix; a check with neither → no fix fields. Offset mapping pinned exactly. No regression to lint/impact/assemble.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 lint.ts translates Offense.fix (FixDescription) → AgentFix (text_edit|insert|guidance) on ValidateCodeDiagnostic.fix, and Offense.suggest → diagnostic.suggestion; offsets mapped faithfully (AgentFix 0-based indices, not conflated with 1-based line/col)
- [ ] #2 assemble.ts populates top-level proposed_fixes from the per-diagnostic fixes (each carrying its originating check), replacing the hardcoded []
- [ ] #3 Edit text is never regenerated — only translated from the engine's FixDescription (types.ts invariant preserved)
- [ ] #4 Whole-value tests: text-edit fix appears on diagnostic + proposed_fixes with check; suggest-only → suggestion; neither → no fix fields; exact offset mapping pinned
- [ ] #5 supervisor suite + type-check + format green; no regression to lint/impact/assemble; scope/overlap with TASK-8.3 documented
<!-- AC:END -->
