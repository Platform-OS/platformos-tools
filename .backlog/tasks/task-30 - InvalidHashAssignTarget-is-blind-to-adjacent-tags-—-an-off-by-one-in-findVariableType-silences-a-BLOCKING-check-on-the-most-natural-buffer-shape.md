---
id: TASK-30
title: >-
  InvalidHashAssignTarget is blind to adjacent tags — an off-by-one in
  findVariableType silences a BLOCKING check on the most natural buffer shape
status: To Do
assignee: []
created_date: '2026-08-01 20:12'
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
- [ ] #1 The adjacent shape reports the offense, for each of the number, string, boolean and range target types
- [ ] #2 Existing separated-shape behaviour is unchanged — same offense, same position, for both the one-space and one-newline forms
- [ ] #3 A spec case pins BOTH shapes for the same defect, so the boundary cannot silently reappear
- [ ] #4 No new false positives: a hash_assign adjacent to a parse_json or graphql tag (both legitimately object-typed) stays silent
- [ ] #5 Reassignment ordering still resolves to the LATEST applicable type when ranges abut — verified with an assign, a hash_assign and a second assign written with no separators
- [ ] #6 check-common, check-node, LSP and CLI suites pass; the supervisor's blocking-emission suite still passes
<!-- AC:END -->
