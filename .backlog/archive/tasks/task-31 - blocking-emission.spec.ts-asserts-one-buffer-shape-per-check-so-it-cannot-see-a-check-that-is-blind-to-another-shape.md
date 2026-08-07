---
id: TASK-31
title: >-
  blocking-emission.spec.ts asserts one buffer shape per check, so it cannot see
  a check that is blind to another shape
status: Done
assignee: []
created_date: '2026-08-01 20:12'
updated_date: '2026-08-07 12:45'
labels:
  - mcp-supervisor
  - testing
  - robustness
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
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
- [x] #1 For each member, a second buffer differing from the first ONLY in adjacency produces the same verdict — same gate outcome and same set of error codes
- [x] #2 The invariant is stated as AGREEMENT between shapes, not as a second hardcoded expectation per member, so adding a member does not mean writing its output twice
- [x] #3 There is no per-member exemption list; a member that cannot satisfy the invariant is a defect to fix, not an entry to skip
- [x] #4 Sabotage-verified: reverting TASK-30's fix fails this suite, and fails it on the InvalidHashAssignTarget row specifically
- [x] #5 The existing per-member emission assertions are unchanged — this adds an axis, it does not replace the exhaustiveness guard
- [x] #6 Runtime stays acceptable for a suite that runs on every change; if doubling the fixtures is too slow, the narrowing rule is written down with its rationale
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
`blocking-emission.spec.ts` gained an adjacency axis: `adjacencyVariants(content)` derives the distinct spellings of a buffer that differ only in whitespace BETWEEN Liquid tags (`%} {%` <-> `%}{%`), and every member must produce the same verdict across all of them.

Stated as AGREEMENT, per AC#2: the expectation is written once and asserted as `variants.map(() => agreed)`. No member is ever given a second hand-written answer, so a check that behaves differently across shapes fails rather than having its inconsistency encoded as intent.

No exemption list, per AC#3. What IS pinned is an observation: which fixtures actually carry the axis (today, `['InvalidHashAssignTarget']`). A fixture rewritten into a single tag loses the axis silently otherwise, and a new multi-tag fixture would add coverage unremarked. Sabotage-verified in both directions — collapsing the one axis-carrying fixture fails 3 tests, and giving a second fixture an axis fails the pin.

Suite is now 26 tests, 2.3 s of test time (6.4 s wall including transform and setup). No narrowing rule was needed.

THE DESIGN QUESTION IN THE TASK WAS SETTLED BY MEASUREMENT, and the answer was not the one the task assumed. Before writing anything I probed whether a UNIVERSAL adjacency axis could be manufactured, by injecting a benign `{% assign shape_probe = 1 %}` before and after each fixture in both spacings, across all ten members:

- prepend adjacent vs separated: identical verdict, 10/10 members
- append adjacent vs separated: identical verdict, 10/10 members
- INCLUDING for `InvalidHashAssignTarget` itself, which HAD the defect at the time

So probe injection would have added twenty lint calls and exactly zero signal. The reason is structural: the axis only exists between tags the check RELATES TO EACH OTHER, and an injected probe is related to nothing. `InvalidHashAssignTarget` reasons about the span between an `assign` and a `hash_assign`; padding either end of the buffer does not touch that span.

That is why the transformation operates on the fixture's OWN text rather than on injected content, and why the axis is thin: fixtures are deliberately minimal, and most are a single construct with no inter-tag boundary at all. Thin BY MEASUREMENT, not by neglect — recorded in the spec so the next reader does not 'improve' it back into the probe-injection version.

AC#4 VERIFIED PRECISELY. Reverting TASK-30's one character in check-common and rebuilding its dist fails this suite with exactly ONE failure, on the `InvalidHashAssignTarget: inter-tag whitespace does not change the verdict` row. Not a broad breakage, not a different row — the defect is named by the test that catches it.

Worth recording for anyone repeating this: the supervisor imports check-common from `dist`, so a source-only edit is INERT and a sabotage that skips the rebuild proves nothing. An earlier cross-package sabotage in this package passed for exactly that reason and had to be redone.

ORDERING WAS THE POINT, not a convenience. Round 3's recommendation — 'a second shape per check' — could not have been implemented before TASK-30 without one of three bad outcomes: a permanently red test asserting a known bug, a per-member exemption reintroducing the self-concealing structure TASK-29 removed, or blanket fixture-doubling that the measurement above shows is pure cost. Fixing the one violator first made the invariant assertable as a clean property.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`blocking-emission.spec.ts` asserted that ONE buffer per blocking check emits, which cannot detect a check blind to a DIFFERENT buffer for the same defect — the exact hole that let `InvalidHashAssignTarget` ship broken while the suite was green.

Added an adjacency axis: variants of each fixture differing only in whitespace between Liquid tags must produce the same verdict, expressed as agreement against a single expectation rather than as per-member duplicated answers. Which fixtures actually carry the axis is pinned as an observation, so it cannot drift silently in either direction.

The task's open design question — cover every member, or a subset — was settled by measurement rather than judgement: injecting a benign probe tag to manufacture an axis for every member changed nothing for any of the ten, including the one that had the defect, because the axis only exists between tags a check relates to each other. The transformation therefore uses the fixture's own text, and the axis is thin because fixtures are minimal, which is now recorded in the spec so it is not "improved" back.

Sabotage-verified three ways: reverting TASK-30 fails exactly the InvalidHashAssignTarget row; collapsing that fixture to a single tag fails three tests; giving a second fixture an axis fails the pin.
<!-- SECTION:FINAL_SUMMARY:END -->
