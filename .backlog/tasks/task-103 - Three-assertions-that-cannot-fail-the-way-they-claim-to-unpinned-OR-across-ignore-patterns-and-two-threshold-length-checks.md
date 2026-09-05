---
id: TASK-103
title: >-
  Three assertions that cannot fail the way they claim to: unpinned OR across
  ignore patterns, and two threshold/length checks
status: Done
assignee: []
created_date: '2026-09-04 11:40'
updated_date: '2026-09-04 12:10'
labels:
  - testing
  - platformos-check-common
  - platformos-common
  - mutation-testing
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.spec.ts
  - >-
    packages/platformos-check-common/src/frontmatter/invalid-frontmatter-syntax.spec.ts
  - packages/platformos-common/src/frontmatter/extract.spec.ts
modified_files:
  - packages/platformos-check-common/src/ignore.spec.ts
  - >-
    packages/platformos-check-common/src/frontmatter/invalid-frontmatter-syntax.spec.ts
  - packages/platformos-common/src/frontmatter/extract.spec.ts
priority: medium
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three places where a test asserts less than its name promises. Grouped as one task because each is a small, self-contained assertion fix in an existing spec, and splitting them would cost more in task overhead than the work itself.

Found by a local Stryker run over `platformos-check-common`, then confirmed by hand. Stryker is not in this repository and is not needed: each item states the one-line change that survives today, so apply it, watch the suite stay green, then fix the assertion and watch it fail.

B1 — THE OR ACROSS IGNORE PATTERNS IS UNASSERTED.
`isIgnored` returns true when the subject matches ANY pattern in a list. Changing `.some` to
`.every` in BOTH places — `ignore.ts:49` for a check's own list and `ignore.ts:67` for the global
one — leaves all 23 tests in `ignore.spec.ts` passing. MEASURED.

The cause is fixtures, not a missing test: every `ignore:` array in the 461-line spec holds
exactly one pattern, and with one pattern `.some` and `.every` are the same function. The test
that appears to use three (`['node_modules/*', 'node_modules/**', 'node_modules/']`) maps three
SEPARATE configs with one pattern each. A real `.platformos-check.yml` carries several patterns
and a file matches one of them, so the untested case is the ordinary one.

B2 — A POSITION ASSERTED AS A RANGE, COLLAPSED TO A BOOLEAN.
`check-common/src/frontmatter/invalid-frontmatter-syntax.spec.ts:38`:

    expect(offense.start.index >= start && offense.end.index <= end + 1).toBe(true);

Against the repo's rule on threshold assertions where an exact value is knowable. It does kill the
offset arithmetic — verified, mutating `bodyOffset + start` to `- start` fails this test once
platformos-common is rebuilt — so this is assertion quality, NOT a hole. A failure also reports
`expected false to be true`, naming neither index.

B3 — A LENGTH CHECK STANDING IN FOR THE VALUE.
`platformos-common/src/frontmatter/extract.spec.ts:115`:

    expect(block.syntaxErrors.length).toEqual(1);

The pattern CLAUDE.md names explicitly: `length` plus per-property reads instead of one
whole-value equality. The following test in the same file already asserts the messages, so the
two together nearly cover it; the length check is the weak half.

NOT IN SCOPE: the pattern-handling defects in `isIgnored` itself. Those are TASK-102 and its
subtasks. B1 is the test-side counterpart and stays independent of them — the fixtures TASK-102.1
needs contain an empty entry that is then discarded, which leaves one live pattern and so cannot
exercise the OR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ignore.spec.ts` drives `isIgnored` with a list of at least two patterns where the subject matches exactly ONE, for the per-check list and for the global list
- [x] #2 A control in the same area asserts a subject matching NONE of several patterns is not ignored, so the OR case cannot pass by ignoring everything
- [x] #3 SABOTAGE-VERIFIED for B1: changing `.some` to `.every` at `ignore.ts:49` fails a test, and independently at `ignore.ts:67` fails a test; both reverted afterwards
- [x] #4 `invalid-frontmatter-syntax.spec.ts:38` asserts the offense's start and end against exact values derived from the source, not a boolean over a range
- [x] #5 `extract.spec.ts:115` asserts the whole `syntaxErrors` value in one equality rather than its length; the message assertion that follows is folded in or left non-duplicating
- [x] #6 SABOTAGE-VERIFIED for B2 and B3: the mutations they are meant to catch still fail them — for B2 that platformos-common is REBUILT first, since check-common imports it from `dist`
- [x] #7 platformos-common and platformos-check-common suites pass, plus type-check and format:check
- [x] #8 No source file changes — this task is assertions only
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. B1: one test asking each list in isolation, with a subject matching one of two patterns and a control matching neither.
2. B2 and B3: measure the real offense position before writing any expectation, then derive it from the source rather than writing an offset.
3. Sabotage each `.some` site independently, and the offset arithmetic against both frontmatter specs — B2 with a rebuild, since check-common reads `dist`.
4. Confirm folding B3's two tests loses nothing, by sabotaging the property the deleted test guarded.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
B1 — one test, both lists asked ALONE so a passing row cannot be the other list answering: the per-check config carries no global patterns, and the global config is asked without a `checkDef`. Two patterns, a subject matching the first, a subject matching the second, and a control matching neither.

Sabotage isolated each site as the AC required:
  `own.some` -> `.every`      (ignore.ts:49)  -> the new test fails, and so does 102.1's blank-entry test, whose fixture now carries two live patterns after the blank is dropped
  `compiled.some` -> `.every` (ignore.ts:67)  -> only the new test fails

B2 — the old assertion was `start >= x && end <= y + 1` collapsed with `.toBe(true)`, which reports `expected false to be true` and names neither index. Replaced with an exact equality over the mapped offense list, so it also pins that there is exactly ONE offense, which `const [offense] =` silently ignored.

The position is DERIVED, not written: measured first, `start.index` is 33 and `end.index` 34 on that fixture, and 33 is `source.indexOf('\n---\n')` — the parser points at the line break closing the unclosed sequence. So the expectation reads `breakAfterUnclosed` and `+ 1`.

I weighed the old comment's stance, which deliberately pinned only 'the range lands inside the block, not what our YAML dialect calls the problem'. Pinning exactly does couple the test to the `yaml` package's error position — but that position IS the squiggle a user sees, TASK-91's tests already pin offsets exactly by slicing the source, and if a library upgrade moves it, a failing test is the correct outcome rather than rot.

B3 — the two tests shared one fixture and split one value between them: a `length` check in the control test, and a `.map(e => e.message)` check in the next. Folded into a single whole-value equality over `syntaxErrors`, with both rationales kept in the docblock. Net one test fewer and a strictly stronger assertion.

FOLDING WAS VERIFIED NOT TO LOSE THE DELETED TEST'S GUARD, which is the risk in merging: flipping `prettyErrors` to `true` in `FRONTMATTER_PARSE_OPTIONS` — the caret-diagram regression a user actually hit — still fails the merged test.

The offset sabotage (`bodyOffset + start` -> `- start`) now fails B3, which the old length-only assertion could not detect at all, and still fails B2.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three assertions strengthened so they can fail the way their names promise. **No source files changed** — spec files only.

**B1, `ignore.spec.ts`.** `isIgnored` matches a list with OR, but every fixture in the file carried a single pattern, where `.some` and `.every` are the same function — so the ordinary case, several patterns of which a file matches one, was unasserted in both lists. One new test asks each list in isolation (the per-check config has no global patterns; the global config is asked without a `checkDef`), with a subject matching the first pattern, one matching the second, and a control matching neither. Sabotage confirms each `.some` site independently.

**B2, `invalid-frontmatter-syntax.spec.ts`.** Replaced `expect(start >= x && end <= y + 1).toBe(true)` — which reports `expected false to be true` and names neither index — with an exact equality over the mapped offense list. That also pins there is exactly one offense, which the previous `const [offense] =` silently ignored. The position is derived from the source (`source.indexOf('\n---\n')`, measured to be where the parser points) rather than written as a number.

**B3, `extract.spec.ts`.** Two tests shared one fixture and split one value between them — a `length` check and a message check. Folded into a single whole-value equality over `syntaxErrors`, both rationales preserved in the docblock. Net one test fewer, strictly stronger: the offset mutation `bodyOffset + start` → `- start` now fails it, which a length check could never detect.

**Verification.** Every claim sabotaged. Each `.some` site independently; the offset arithmetic against B2 (with platformos-common rebuilt, since check-common reads `dist`) and B3; and — because merging tests risks losing a guard — `prettyErrors: true`, the caret-diagram regression the deleted test existed for, still fails the merged test. platformos-common + platformos-check-common 2408/2408 across 126 files, both type-checks clean, repo `format:check` clean.
<!-- SECTION:FINAL_SUMMARY:END -->
