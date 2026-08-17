---
id: TASK-8.6
title: SUPERSEDED — the fix/suggest passthrough moved into TASK-7.6 and TASK-7.7
status: To Do
assignee: []
created_date: '2026-07-02 15:00'
updated_date: '2026-08-16 12:07'
labels:
  - mcp-supervisor
  - fixes
  - ergonomics
dependencies:
  - TASK-7.6
  - TASK-7.7
references:
  - packages/platformos-mcp-supervisor/src/lint/lint-batch.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
parent_task_id: TASK-8
priority: high
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## SUPERSEDED 2026-08-16 — do not implement this separately

Three tasks claimed the same seam: this one, TASK-7.6 AC #2 ("carry `Offense.fix` and
`suggest` through as typed data") and TASK-7.7 ("map `FixDescription` to the agent-facing
`AgentFix`"). One mapping written three times is three chances to disagree about offsets,
which is exactly the class of defect the structured seam exists to remove.

The work is consolidated as:

- **TASK-7.6** — stop dropping them. `toDiagnostic` in `lint/lint-batch.ts` currently sets
  seven fields and discards `Offense.fix` / `Offense.suggest`; it carries them through.
- **TASK-7.7** — translate them. Run the engine's `Fixer` through check-common's
  `StringCorrector` + `applyFixToString` to get `FixDescription[]`, map to `AgentFix`, and
  set `diagnostic.suggestion` from `suggest`. Edit text is never regenerated.

Both are in TASK-7, both keep this task's constraints, and both keep its test demands:
whole-value assertions, exact offset pinning, and the distinction that matters —
diagnostics use 1-based line/column while `AgentFix` uses 0-based `start_index` /
`end_index`, and the two must never be conflated.

## The one thing that does NOT carry over

**`proposed_fixes` is not coming back.** This task asked for a top-level
`proposed_fixes: ProposedFix[]` populated from the per-diagnostic fixes. It was a
permanently-empty stub deleted by TASK-12.5 along with five siblings, and `assemble.spec.ts`
now pins the exact result key set with it asserted ABSENT. Whether a top-level roll-up of
the per-diagnostic fixes is worth re-adding is TASK-8.4's question, decided on evidence
rather than on v1 having had it — the fixes themselves reach the agent on the diagnostic
either way.

Archive this task once TASK-7.6 and TASK-7.7 have landed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No fix/suggest translation is implemented under this task; TASK-7.6 carries the fields through and TASK-7.7 performs the mapping
- [ ] #2 proposed_fixes is not re-added here; assemble.spec.ts still asserts it absent
- [ ] #3 This task is archived once TASK-7.6 and TASK-7.7 have landed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — half the target no longer exists, the other half is declared but dead

**`proposed_fixes` is gone.** It was a permanently-empty result stub deleted by TASK-12.5
(archived) with five siblings. Re-adding it means updating `assemble.spec.ts`'s exact
key-set guard deliberately, and only once something populates it.

**`diagnostic.fix` DOES exist in the type and is never populated — which is the more
interesting half.** `ValidateCodeDiagnostic` declares `hint?`, `suggestion?`,
`confidence?`, `fix?: AgentFix` and `see_also?`, and `AgentFix` is fully specified. But
`toDiagnostic` in `lint/lint-batch.ts:166` — the only place an `Offense` becomes a
diagnostic — sets exactly seven fields: `check`, `severity`, `message`, `line`, `column`,
`end_line`, `end_column`. `Offense.fix` and `Offense.suggest` are dropped on the floor.

So the agent-facing shape for enrichment is already designed and typed; nothing fills it.
Unlike the removed result stubs, these are OPTIONAL and simply absent from responses, and
`transport/instructions.ts` does not advertise them — so this is latent contract surface
rather than a live false promise. Worth keeping that way until populated.

**Overlaps TASK-7.7 and TASK-7.6 AC #2**, both of which describe carrying `fix`/`suggest`
through to the agent surface. Three tasks currently claim this same seam; consider merging
before starting, so the mapping is not written twice.
<!-- SECTION:NOTES:END -->
