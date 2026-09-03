---
id: TASK-101
title: >-
  hasScheme's anchor is load-bearing and untested — a path containing "word:" is
  treated as a URI
status: Done
assignee: []
created_date: '2026-09-03 09:54'
updated_date: '2026-09-03 10:05'
labels:
  - testing
  - platformos-common
  - cross-platform
  - mutation-testing
dependencies: []
references:
  - packages/platformos-common/src/os-path.ts
  - packages/platformos-common/src/os-path.spec.ts
  - packages/platformos-check-common/src/ignore.ts
modified_files:
  - packages/platformos-common/src/os-path.spec.ts
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`uriFromPathOrUri` in `platformos-common/src/os-path.ts` decides whether its argument is a filesystem path or a URI, and routes it to `uriFromPath` or `normalizeUri` accordingly. That decision is made by one regex:

    function hasScheme(pathOrUri: string): boolean {
      return /^[a-z][a-z0-9+.-]+:/i.test(pathOrUri);
    }

The `^` is load-bearing, and nothing asserts it.

MEASURED — dropping the anchor changes the answer for a legal filename:

    input                                              anchored   unanchored
    app/views/pages/index.liquid                       false      false
    C:\repo\app\x.liquid                               false      false
    /home/u/.../time_12:30.liquid                      false      false
    notes/TODO: rewrite.md                             false      TRUE     <-- diverges
    file:///c:/a/x.liquid                              true       true
    mock-fs:/app/x.liquid                              true       true

A colon preceded by two or more `[a-z0-9+.-]` characters anywhere in the string is enough. `TODO:` qualifies; `a:` does not (the regex needs two characters before the colon), which is why a drive letter still reads as a path — the case the function's own docblock calls out.

WHY IT MATTERS: a path misclassified as a URI goes to `normalizeUri` instead of `uriFromPath`, producing a plausible-looking URI for a different location. That is precisely the failure CLAUDE.md's three-normalizer rule exists to prevent, in the one function documented to accept "a path of unknown provenance" — a CLI argument, an `ignore` subject. `check-common/src/ignore.ts` calls it on every ignore subject, and `find-root.ts` on its input.

MEASURED — nothing kills the mutant. With the anchor removed and platformos-common rebuilt, `os-path.spec.ts`, `find-root.spec.ts` and `check-common/src/ignore.spec.ts` all pass: 66 tests, 0 failures.

The behaviour is CORRECT today. This task adds the assertion that keeps it correct.

HOW THIS WAS FOUND, and what a future implementer needs: a local Stryker run over platformos-common's path and parsing primitives. Stryker is NOT part of this repository — its configs are gitignored — and you do not need it. Apply the one-line change by hand, confirm the new test fails, revert. That is the verification.

ONE TRAP THAT COST TIME HERE: `check-common` imports `@platformos/platformos-common` from `dist`, not `src`. A cross-package sabotage that skips `yarn workspace @platformos/platformos-common build` tests the OLD code and reports a false "no test catches this". Rebuild after mutating and again after reverting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test asserts that `uriFromPathOrUri` treats a WINDOWS-shaped path whose later segment contains `word:` as a PATH, returning the `uriFromPath` spelling rather than the `normalizeUri` one — corrected from the original wording, which named a posix example that cannot distinguish the two branches (see notes)
- [x] #2 A control in the same test asserts a genuine URI (a non-file scheme such as `mock-fs:/…`) is still treated as a URI, so the assertion cannot pass by classifying everything as a path
- [x] #3 A drive letter (`c:\\project\\app\\x.liquid`) is still treated as a path, pinning the two-character minimum the docblock relies on
- [x] #4 SABOTAGE-VERIFIED: removing `^` from the regex in `hasScheme` makes the new test fail, and no other test in platformos-common or platformos-check-common changes result; the change is reverted afterwards and both suites are green
- [x] #5 Assertions use whole-value equality on the returned URI per the repo's test guidelines, not a boolean `hasScheme` probe — `hasScheme` is private and the contract belongs to `uriFromPathOrUri`
- [x] #6 platformos-common and platformos-check-common suites pass, plus type-check and format:check
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Measure what the two branches actually RETURN for candidate inputs, not just how the regex classifies them.
2. Pick fixtures from that measurement rather than from the task description.
3. Add one test to the existing `uriFromPathOrUri` describe, with a scheme control in the same equality.
4. Sabotage with a rebuild of platformos-common (check-common imports `dist`), across BOTH package suites.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THIS TASK'S OWN PREMISE WAS HALF WRONG, and finding that out changed the fixtures. The description asserted that dropping the `^` misroutes `notes/TODO: rewrite.md`. The REGEX does classify it differently — that part was measured. But the two branches then return the SAME STRING for a posix path:

    uriFromPath('/home/u/project/notes/TODO: rewrite.md')   -> 'file:///home/u/project/notes/TODO: rewrite.md'
    normalizeUri('/home/u/project/notes/TODO: rewrite.md')  -> 'file:///home/u/project/notes/TODO: rewrite.md'

So a posix fixture passes with the anchor deleted, and a test built on the description would have been decorative. This is the same error twice in one sitting: measuring the CLASSIFICATION and assuming the RESULT. Two claims, one measured.

WHERE IT IS ACTUALLY OBSERVABLE — measured across the candidates, only Windows-shaped paths distinguish the branches:

    'C:\\repo\\notes\\TODO: rewrite.md'    anchored 'file:///c:/repo/notes/TODO: rewrite.md'   unanchored 'C:/repo/notes/TODO: rewrite.md'
    'app\\views\\pages\\TODO: x.liquid'    anchored 'file:///app/views/pages/TODO: x.liquid'   unanchored THROWS UriError
    '/home/u/…/notes/TODO: rewrite.md'      identical either way
    '../notes/TODO: rewrite.md'            identical either way
    'C:\\repo\\app\\x.liquid'              identical either way (one char before the colon, no match)

The second case is the strongest statement of the contract: without the anchor, a function whose docblock says it takes anything crossing a public API THROWS on a path. Both fixtures are in the test, and the comment says why they are Windows-shaped so nobody 'simplifies' them to posix and quietly makes the test vacuous.

HONEST NOTE ON REACHABILITY: a colon is illegal in a Windows filename, so these exact strings will not arrive from a Windows filesystem walk. They can arrive as an `ignore` pattern, a CLI argument, or a config authored elsewhere — which is exactly the 'unknown provenance' input this function exists for. The anchor is a guard on a narrow path, not a live bug.

SABOTAGE: anchor removed and platformos-common rebuilt — platformos-common 1 failed / 588 passed, the failure being only the new test; platformos-check-common 1816/1816 still passed, so nothing anywhere else in the monorepo catches this. Reverted and rebuilt: 589 and 1816 green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pins the `^` in `hasScheme`, which decides whether `uriFromPathOrUri` treats its argument as a path or a URI and which nothing in the monorepo asserted. One test added to `os-path.spec.ts`; **no source file changed**.

**The fixtures are not the ones this task asked for, and that is the substance of the change.** The description claimed the anchor is observable on `notes/TODO: rewrite.md`. It is not: the regex classifies that path differently without `^`, but `uriFromPath` and `normalizeUri` then return the *same string* for any posix path, so a test written to the description would have passed with the anchor deleted. The premise measured the classification and assumed the result.

Measured across candidates, only Windows-shaped inputs distinguish the branches, and both are now in the test:

- `C:\repo\notes\TODO: rewrite.md` — correct `file:///c:/repo/notes/TODO: rewrite.md`, unanchored `C:/repo/notes/TODO: rewrite.md` (no scheme, drive not lowercased).
- `app\views\pages\TODO: x.liquid` — correct `file:///app/views/pages/TODO: x.liquid`, unanchored **throws `UriError`**. That is the sharper statement of the contract: the function's docblock says it takes anything crossing a public API, and without the anchor it throws on a path.

A `mock-fs:` control rides in the same equality so the test cannot pass against a function that stopped recognising schemes altogether, and the comment records *why* the fixtures are Windows-shaped — a later "simplification" to a posix path would silently make the test vacuous.

**Verification.** Anchor removed and platformos-common rebuilt (check-common imports `dist`, not `src`): platformos-common 1 failed / 588 passed, the failure being only the new test; platformos-check-common 1816/1816 still passed, confirming nothing else in the monorepo catches this. Reverted and rebuilt: platformos-common 589/589, platformos-check-common 1816/1816, type-check and prettier clean.

**Scope note kept deliberately honest:** a colon is illegal in a Windows filename, so these strings cannot arrive from a filesystem walk. They can arrive as an `ignore` pattern, a CLI argument, or a config authored on another OS — the unknown-provenance input this function exists for. The anchor is a guard on a narrow path, not a live bug, and the test is worth its four lines on that basis rather than a stronger one.
<!-- SECTION:FINAL_SUMMARY:END -->
