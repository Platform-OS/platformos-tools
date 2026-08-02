---
id: TASK-36
title: >-
  Sweep all 140 reporting filter return types against hash_assign — sampling
  cannot find an over-accepting entry
status: To Do
assignee: []
created_date: '2026-08-02 07:10'
updated_date: '2026-08-02 07:15'
labels:
  - check-common
  - false-block
  - testing
  - eval-round4
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
modified_files:
  - >-
    packages/platformos-check-common/src/checks/invalid-hash-assign-target/index.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`InvalidHashAssignTarget` now derives variable types from the docset `return_type`. Four spellings map to reporting types: `string` (78 filters), `array` (31), `number` (17), `boolean` (14) — 140 filters in total. A single wrong `return_type` among them is a false block on valid code.

Round 4 tested roughly a dozen of the 140 and named this the largest unexamined surface it was aware of. Its reasoning is correct and worth preserving: sampling a subset of an accepting population cannot find an over-accepting member. This is the same structural blindness that let twelve fictional filter names survive round 1, and it was closed there by a full sweep rather than more sampling.

## What to do

Mechanically exercise every one of the 140: assign a variable through the filter, then `hash_assign` into it with both a key and an index subscript, and compare the check's verdict against the runtime.

`liquid_exec` is the correct oracle here, not `--dry-run`. A bad `hash_assign` target is a runtime raise, not a converter rejection; the converter accepts every one of these buffers. The rule that the dry-run oracle outranks the runtime one is scoped to syntax.

## Related

The complementary gap — six spellings deliberately mapped to `untyped`, five of which the runtime can now disambiguate — is TASK-37. This task is about the filters that DO report, and whether every one of them should.<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every filter whose docset return_type maps to a reporting type is exercised through assign-then-hash_assign, with both a key subscript and an index subscript
- [ ] #2 Each reported case is settled against the runtime oracle, so a report is known to be a true positive rather than assumed to be one
- [ ] #3 Any filter whose docset return_type is contradicted by the runtime is recorded with the evidence, and the resulting fix is either a mapping change or a docset data correction, named explicitly
- [ ] #4 The sweep is a repeatable artefact in the repo, so a docset update re-runs it instead of requiring the analysis to be redone by hand
- [ ] #5 The filters mapped to untyped are listed with their spellings, so the deliberately-silent population is visible rather than implicit
<!-- AC:END -->
