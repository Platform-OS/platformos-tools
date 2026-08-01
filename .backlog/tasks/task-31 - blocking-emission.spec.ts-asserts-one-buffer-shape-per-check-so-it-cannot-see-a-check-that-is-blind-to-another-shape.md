---
id: TASK-31
title: >-
  blocking-emission.spec.ts asserts one buffer shape per check, so it cannot see
  a check that is blind to another shape
status: To Do
assignee: []
created_date: '2026-08-01 20:12'
labels:
  - mcp-supervisor
  - testing
  - robustness
dependencies:
  - TASK-30
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`blocking-emission.spec.ts` closed the "a registered check emits nothing" hole (TASK-29) by driving one real buffer per `BLOCKING_CHECKS` member through the real pipeline. Round 3 found the gap it still has: it asserts that *a* shape emits, which cannot detect a check that is blind to *another* shape.

Concretely, `blocking-emission.spec.ts:129` uses the SEPARATED form:

```ts
content: "{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}\n",
```

and `InvalidHashAssignTarget` is silent on the ADJACENT form (TASK-30). The chosen fixture sits on the working side of a boundary the check has. The suite is green and the defect is real.

The suite's design is right and this does not undermine it — `blocking.spec.ts` could never have caught this class at all, and driving real buffers is what makes the question askable. The gap is one axis of coverage, not a wrong approach.

## Why the obvious fix is wrong

Round 3 recommends "a second shape per check — adjacent and separated". Taken literally that has three bad outcomes:

1. Adding the adjacent shape for `InvalidHashAssignTarget` makes the suite RED today, waiting on a check-common fix. A test that asserts a known bug breaks when the bug is fixed.
2. Exempting that one member reintroduces exactly the self-concealing per-member exemption structure TASK-29 removed.
3. Blanket fixture-doubling is mostly cost: round 3 measured five other position- or scope-reasoning checks (`UnusedAssign`, `MissingRenderPartialArguments`, `UnknownFilter`, `FilterArity`, `JsonLiteralQuoteStyle`) across both shapes and all five agreed. Shape sensitivity is one check, not a class.

## The property actually worth asserting

Not "both shapes fire" — that is a per-check precision claim check-common owns. The invariant is **agreement**: two buffers differing only in adjacency must produce the same verdict. No check should ever violate that, it is cheap to state, and it fails loudly for whichever member breaks it rather than encoding each check's expected output twice.

That invariant is only assertable once the one known violator is fixed, which is why this depends on TASK-30. Land TASK-30, then add this — the ordering is the point, not a convenience.

## Open design question for the implementer

Whether the agreement pass covers every member or only those whose check reasons about position/scope. Covering every member is simpler to state and cannot rot; covering a subset needs a rule for membership, which is the kind of list that goes stale. Prefer the simple version unless the runtime cost is real — the current suite is ~1 s.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 For each member, a second buffer differing from the first ONLY in adjacency produces the same verdict — same gate outcome and same set of error codes
- [ ] #2 The invariant is stated as AGREEMENT between shapes, not as a second hardcoded expectation per member, so adding a member does not mean writing its output twice
- [ ] #3 There is no per-member exemption list; a member that cannot satisfy the invariant is a defect to fix, not an entry to skip
- [ ] #4 Sabotage-verified: reverting TASK-30's fix fails this suite, and fails it on the InvalidHashAssignTarget row specifically
- [ ] #5 The existing per-member emission assertions are unchanged — this adds an axis, it does not replace the exhaustiveness guard
- [ ] #6 Runtime stays acceptable for a suite that runs on every change; if doubling the fixtures is too slow, the narrowing rule is written down with its rationale
<!-- AC:END -->
