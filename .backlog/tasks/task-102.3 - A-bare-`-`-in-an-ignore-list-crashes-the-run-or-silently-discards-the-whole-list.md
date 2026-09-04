---
id: TASK-102.3
title: >-
  A bare `-` in an ignore list crashes the run, or silently discards the whole
  list
status: Done
assignee: []
created_date: '2026-09-04 11:32'
updated_date: '2026-09-04 11:59'
labels:
  - bug
  - platformos-check-common
  - platformos-check-node
  - ignore
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-node/src/config/resolve/read-yaml.ts
  - packages/platformos-check-node/src/config/validation.ts
modified_files:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-common/src/ignore.spec.ts
  - .changeset/a-malformed-ignore-entry-no-longer-crashes-the-run.md
parent_task_id: TASK-102
priority: medium
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
YAML turns a bare `-` into `null`, and the two ignore lists react to it differently — both badly.

    ignore:
      -
      - modules/vendor

TOP-LEVEL LIST — crashes. The element reaches `rewrite()` and hits `.startsWith` on `null`:

    TypeError: Cannot read properties of null (reading 'startsWith')

`ConfigDescription.ignore` is typed `string[]`, which is a compile-time claim about data that
came from a YAML file at runtime; nothing checks the elements. `undefined` fails the same way.

PER-CHECK LIST — silently discards everything. `read-yaml.ts:202` guards the assignment with
`settings.ignore.every(isString)`, so ONE bad element causes the entire `ignore` list for that
check to be dropped. The config loads, the run succeeds, and every pattern the user wrote is
quietly not applied. That direction is the more dangerous of the two: a crash is at least
visible.

Neither behaviour is defensible for a one-character typo in a config file, and the two halves
disagreeing is itself a defect — the same input should get the same answer wherever it appears.

THE FIX IS A DESIGN CHOICE, shared with subtask .1 and best settled once for both: REFUSE the
config, naming the list and the offending index, or DROP the bad element and keep the rest.
Whichever is chosen, a malformed element must not silently take valid patterns with it, and must
not throw an unhandled TypeError.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A `null` element in the top-level `ignore` list no longer throws an unhandled `TypeError`
- [x] #2 A `null` element in a per-check `ignore` list no longer throws either, and the rest of that list still applies — CORRECTED from the original wording, which said the list was silently discarded; it never was (see notes)
- [x] #3 The two lists answer the same way for the same malformed element
- [x] #4 The valid entries alongside it still apply, with a control asserting a file matching one of them is still ignored and a file matching none is still checked
- [x] #5 `undefined` and a non-string element (a number, a nested list) are covered by the same handling, not just `null`
- [x] #6 The drop-not-refuse choice is recorded in a comment at the code that implements it, with the reason
- [x] #7 SABOTAGE-VERIFIED: removing the type guard fails the new test and nothing else; removing the whole filter fails this test and both from TASK-102.1; reverted afterwards and the suite is green
- [x] #8 platformos-check-common and platformos-check-node suites pass, plus type-check and format:check
- [x] #9 A changeset accompanies the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-measure both halves before changing anything, because the task's description of the per-check half was written from reading one `if` in isolation.
2. Establish who actually consumes the ignore settings, to decide whether the fix belongs in one place or two.
3. Extend the existing filter at the choke point; add one test that asks each list in isolation.
4. Sabotage the type guard alone and the whole filter; then re-run the end-to-end case that threw.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THE TASK DESCRIPTION WAS WRONG ABOUT THE PER-CHECK HALF, and re-measuring first is what caught it. It claimed `read-yaml.ts:202`'s `every(isString)` gate discards the whole list when one element is bad. It does not: the `Object.entries` loop immediately above already copies every setting verbatim, `ignore` included, so the gate only skips a redundant re-assignment. Measured through the real loader:

    global ignore    -> ["node_modules", null, "modules/vendor/**"]
    per-check ignore -> [null, "app/views/partials/**"]

Both lists keep the null, so both fail the SAME way — the crash — and there was never a silent-discard defect. That made the fix one filter instead of two, and made AC#3 true of the defect rather than something to engineer.

DELIBERATELY DID NOT TOUCH `read-yaml.ts`. The `every(isString)` gate is misleading and `CheckSettings.ignore` is typed `string[]` while holding nulls at runtime, so changing it to `.filter(isString)` — which is what the same file already does for `require` and `extends` — was tempting. I checked the consumers first: `ignore.ts:174` is the ONLY reader of a check's own ignore list, and `merge-fragments.ts:27` merely concatenates the global ones. With the choke point now defensive, editing read-yaml would be cleanup of a latent type lie with one already-safe consumer: regression risk for no behavioural gain.

WHERE: the same `.filter` in `compiled()` that TASK-102.1 added, widened from `pattern !== ''` to `typeof pattern === 'string' && pattern !== ''`. One place covers the global list, every check's own list, and every runtime that consumes check-common.

SABOTAGE, two levels, to prove the two fixes are independently pinned:
  type guard removed (back to the 102.1 filter) -> only the new test fails
  whole filter removed                          -> the new test AND both 102.1 tests fail

END TO END, real config through the real loader and `check()`, on a project with a broken page in `app/views/pages` and another under `modules/vendor/public/views/pages`:

    no ignore (baseline)          4 offenses, both files
    sound pattern only            2 offenses, app page only
    bare `-` alongside it         2 offenses, app page only   <- identical; previously THREW
    bare `-` in a per-check list  2 offenses, app page only   <- previously THREW
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A malformed `ignore` entry is now skipped where a blank one already was, instead of throwing out of the entire run.

**The defect.** A bare `-` in a YAML list is `null`, and nothing checked the elements — both lists are typed `string[]` over data read from a file. The `null` reached `.startsWith` during pattern rewriting and killed the run: `check()` on a real project raised `TypeError: Cannot read properties of null (reading 'startsWith')`.

**The fix** widens the filter TASK-102.1 added in `compiled()` from `pattern !== ''` to `typeof pattern === 'string' && pattern !== ''`. One line, at the single choke point the top-level list, every check's own list, and every runtime pass through. Drop rather than refuse, inheriting the decision 102.1 settled against `.gitignore`'s treatment of a blank line.

**The task's premise was half wrong, and re-measuring first caught it.** It described the per-check list as silently discarding all its patterns when one element is bad. It never did — the `Object.entries` loop above the `every(isString)` gate copies `ignore` verbatim, so the gate only skips a redundant re-assignment. Both lists keep the `null` and both crash identically. That turned a two-site fix into a one-line one.

**`read-yaml.ts` deliberately untouched.** Its gate is misleading and `CheckSettings.ignore` holds nulls at runtime despite its type, but `ignore.ts:174` is the only reader of that list and `merge-fragments.ts` merely concatenates the global one. With the choke point defensive, changing it would be risk without behavioural gain. Noted rather than silently skipped.

**Verification.** Sabotage at two levels: removing just the type guard fails only the new test, removing the whole filter fails it plus both 102.1 tests — so the two fixes are independently pinned. End to end, the config that previously threw now reports exactly what the same config without the malformed entry reports, with a baseline row proving the sound pattern is genuinely ignoring something. check-common + check-node 2014/2014 across 124 files, both type-checks clean, repo `format:check` clean. Changeset added.
<!-- SECTION:FINAL_SUMMARY:END -->
