---
id: TASK-8.4
title: >-
  Decide the four v1 result fields on evidence, not parity — two are dead, two
  must earn their place
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
updated_date: '2026-08-16 12:06'
labels: []
dependencies:
  - TASK-8.2
references:
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.spec.ts
  - packages/platformos-mcp-supervisor/src/result/response-budget.ts
parent_task_id: TASK-8
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Re-scoped 2026-08-16 — parity is no longer the argument

This task asked for `tips`, `domain_guide`, `structural` and `parse_error` on
`ValidateCodeResult` because v1 emitted them. That reasoning is withdrawn: v1 was wrong in
the ways TASK-7's revision documents, and "v1 had it" is now evidence of nothing.

All four were also present in this package as always-empty stubs and were **deliberately
deleted** by TASK-12.5 (archived), on the grounds that an agent cannot distinguish an
always-empty field from a meaningful one. `assemble.spec.ts` pins the exact key set and
asserts each is ABSENT, including across a JSON round trip. Re-adding one means updating
that guard deliberately — never deleting it.

## `tips` and `domain_guide` — dead

Both were to be fed by TASK-8.2's domain layer, which has been dissolved: gotchas are
documentation that belongs upstream, and content-triggers become check-common checks that
arrive as ordinary diagnostics. There is nothing left to put in either field. They stay
absent. **No work here.**

## `structural` and `parse_error` — must earn their place

Neither is forbidden; both are facts about the user's own file rather than documentation,
so invariant 6 does not reach them. But each has to answer a question v1 never asked.

**`structural`** (slug, layout, method, renders_used, graphql refs, filters_used,
tags_used, translation_keys, doc_params) is a sizeable payload on every response, describing
a buffer the agent just wrote and therefore already knows. Its plausible value is as a
cheap read-back — "here is what I parsed out of what you sent" — which catches a
misunderstanding that no diagnostic fires on. Whether that is worth its size is an empirical
question. Measure it: does an agent given `structural` behave differently from one that is
not? Weigh the answer against the response budget this package already spends effort
bounding.

**`parse_error`** is close to redundant by construction: a file that does not parse already
produces a `LiquidHTMLSyntaxError` or `YAMLSyntaxError` diagnostic, both of which block. A
separate top-level string restates it. The case for keeping it is that a top-level signal
is harder to miss than an entry in a list — which is a claim about agent behaviour, so
measure it rather than assert it.

## The rule that governs all four

A field ships only when something populates it AND its presence changes what an agent does.
Absent that, it is not shipped, and this task's honest outcome may be "none of the four" —
which is a result, not a failure. Record the decision and the evidence either way, so the
question is not reopened from the v1 contract a third time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tips and domain_guide remain absent from ValidateCodeResult, and assemble.spec.ts still asserts them absent across a JSON round trip
- [ ] #2 For structural and parse_error, a recorded measurement shows whether an agent given the field behaves differently from one that is not
- [ ] #3 Any field that ships is populated on every response where it is meaningful, is accounted for in the response budget, and updates the exact-key-set guard deliberately rather than removing it
- [ ] #4 Any field that does not ship has its decision and evidence recorded so the question is not reopened from the v1 contract
- [ ] #5 No field is added on the grounds that v1 emitted it
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
