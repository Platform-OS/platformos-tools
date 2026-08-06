---
id: TASK-30
title: >-
  InvalidHashAssignTarget is blind to adjacent tags — an off-by-one in
  findVariableType silences a BLOCKING check on the most natural buffer shape
status: Done
assignee: []
created_date: '2026-08-01 20:12'
updated_date: '2026-08-01 21:08'
labels:
  - bug
  - check-common
  - correctness
  - false-approval
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND2.md
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
modified_files:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`InvalidHashAssignTarget` is in `BLOCKING_CHECKS`. It does not fire when the `assign` and the `hash_assign` are ADJACENT — no whitespace at all between the two tags. Insert one space or one newline and it fires normally.

```
{% assign x = 5 %}{% hash_assign x['k'] = 'v' %}     -> SILENT   (ok, block=false)
{% assign x = 5 %} {% hash_assign x['k'] = 'v' %}    -> fires @1:35
{% assign x = 5 %}\n{% hash_assign x['k'] = 'v' %}   -> fires @2:16
```

The runtime raises `HashAssignTagError` ("x is 5, expected Hash or Array") on all three, so the silent case is a false approval on a blocking check.

The blindness is bounded precisely at zero characters between the tags. A minimal single-line fixture is the natural thing an author writes, which is why round 2 mistook this for the check being dead.

## Cause — read, not inferred

`checks/invalid-hash-assign-target/index.ts:63`, inside `findVariableType`:

```ts
if (position <= start) continue;
```

Type ranges are pushed with `range: [node.position.end]` — the range for `x` STARTS at the assign tag's end offset. `position` is the `hash_assign` tag's start offset. When the tags are adjacent those two numbers are equal, and `<=` excludes the entry. `findVariableType` then returns `undefined`, the target is untyped, and nothing is reported.

The fix is `position < start`. A node beginning exactly where the previous one ended IS after it; there is no interval in which both could be true, because node positions are unique.

## History — not a regression, and the round-2 diagnosis was wrong

Round 2 reported this as `InvalidHashAssignTarget` having "gone silent", a regression, most likely upstream in `PropertyShapeInference.ts`. All three parts are wrong. The check's source is untouched since `20025dd`; the off-by-one has been there since it was written; `PropertyShapeInference.ts` is not involved. Round 3 bounded it to the adjacency boundary. This is recorded because the reasoning error — reading an absence as evidence about the check rather than about the fixture — is what METHODOLOGY.md's O5 oracle now exists to prevent.

## Note on scope

This is the SHAPE defect. `InvalidHashAssignTarget`'s other known defect — mis-typing filter return values, producing a false block on `{% assign a = '' | split: ',' %}{% hash_assign a[0] = 'v' %}` — is TASK-27 and is independent. Fixing this one does not touch that one, and both were verified to still reproduce in round 3.

## Why this unblocks other work

`blocking-emission.spec.ts` cannot currently assert the stronger property it wants — that two buffer shapes differing only in adjacency AGREE — because this is the one known violator. Fixing it here makes that invariant assertable without a red test or an arbitrary per-member exemption. See the follow-up task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The adjacent shape reports the offense, for each of the number, string, boolean and range target types
- [x] #2 Existing separated-shape behaviour is unchanged — same offense, same position, for both the one-space and one-newline forms
- [x] #3 A spec case pins BOTH shapes for the same defect, so the boundary cannot silently reappear
- [x] #4 No new false positives: a hash_assign adjacent to a parse_json or graphql tag (both legitimately object-typed) stays silent
- [x] #5 Reassignment ordering still resolves to the LATEST applicable type when ranges abut — verified with an assign, a hash_assign and a second assign written with no separators
- [x] #6 check-common, check-node, LSP and CLI suites pass; the supervisor's blocking-emission suite still passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
One character in `findVariableType`, `checks/invalid-hash-assign-target/index.ts`:

    -  if (position <= start) continue;
    +  if (position < start) continue;

A range STARTS at the defining tag's `position.end`, which is an offset a real tag can begin at exactly, because Liquid tags may abut. The exclusive bound excluded precisely that case. A node beginning where the previous one ended IS after it, and no two nodes share an offset, so nothing is admitted wrongly.

Second, smaller change in the same predicate: `end && position > end` became `end !== undefined && position > end`. "No upper bound" is an OPEN range, which is `undefined`; truthiness would also reopen a range closed at offset 0. Documented as DEFENSIVE rather than a live fix — an entry's start is a preceding tag's end, so a close at 0 cannot occur.

The fix also restores detection for definers other than `assign`, which were equally blind at the same boundary: `capture` (range from the block end) and `increment`/`decrement` (range from the tag end) now report when the `hash_assign` abuts them. `parse_json`, `graphql` and `function` targets stay silent, as they should — object and untyped are not reported types.

A CLAIM I WROTE AND THEN DISPROVED, recorded because the comment now says so explicitly. The first version of the doc comment asserted that BOTH bounds are inclusive and that this is 'load-bearing'. Sabotage-testing the end bound (`position > end` -> `position >= end`) changed NO test. On inspection it cannot: a range is closed at the START offset of the tag that redefines the variable, and that tag's own lookup happens BEFORE the close while the range is still open; every later lookup sits at a strictly greater offset. So no lookup can ever land on a closed range's end, and the two spellings are indistinguishable by any buffer. The comment now states the start bound as measured and the end bound as the inclusive READING of the range, explicitly flagged as not distinguishable by test — rather than implying symmetry that was never verified. This is the same failure mode the evaluation keeps finding: a plausible claim written next to a real one, where only the real one was run.

SABOTAGE-VERIFIED. Reverting to `position <= start` fails 4 of the 5 new cases (the three-shape agreement case, the four primitive types, the capture/increment case, and the abutting reassignment). The 15 pre-existing tests pass unchanged both before and after the fix — every one of them separates its tags with a newline, which is exactly why the defect survived to be found by an external evaluation instead of by this file.

TEST DESIGN. New `describe` block written to the house rule — whole-value equality including exact line/character spans, no `toHaveLength` + `toContain`. Positions are asserted because the fix changes WHICH type entry a lookup matches, so 'still reports' is not sufficient; it has to report the same span it always did. The pre-existing cases were left as they are: they are passing behaviour pins and rewriting 15 of them would have buried a one-character change in an unrelated diff.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`InvalidHashAssignTarget` — a member of `BLOCKING_CHECKS` — was silent whenever the `assign` and the `hash_assign` abutted with no character between them, on code the runtime raises `HashAssignTagError` for. One space or newline and it fired. Cause: `findVariableType` tested `position <= start` while a type range starts at the defining tag's end offset, so the adjacent lookup fell exactly on the excluded boundary.

Fixed by making the start bound inclusive. Also restores detection for `capture`, `increment` and `decrement` definers, which were blind at the same boundary, while `parse_json`, `graphql` and `function` targets correctly stay silent.

Five new cases pin the boundary from both sides with exact positions; sabotage-verified that reverting the character fails four of them. All 15 pre-existing tests unchanged — all of them separate their tags, which is why the defect survived two rounds of evaluation and was misdiagnosed once as the check being dead and once as a regression in `PropertyShapeInference.ts`. It was neither: the source is untouched since `20025dd`.
<!-- SECTION:FINAL_SUMMARY:END -->
