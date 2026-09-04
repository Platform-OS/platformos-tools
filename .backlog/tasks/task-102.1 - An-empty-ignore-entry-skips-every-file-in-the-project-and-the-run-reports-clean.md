---
id: TASK-102.1
title: >-
  An empty ignore entry skips every file in the project, and the run reports
  clean
status: Done
assignee: []
created_date: '2026-09-04 11:31'
updated_date: '2026-09-04 11:46'
labels:
  - bug
  - platformos-check-common
  - ignore
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-node/src/config/resolve/read-yaml.ts
modified_files:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-common/src/ignore.spec.ts
  - .changeset/a-blank-ignore-entry-no-longer-silences-the-project.md
parent_task_id: TASK-102
priority: high
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An empty string in an `ignore` list becomes a pattern that matches everything, so the whole project is skipped and `check()` returns no offenses. The run exits clean and nothing says why.

MEASURED, real config file through the real loader and `check()`:

    ignore:
      - ""
      - modules/vendor
    -> offenses reported: 0

    ignore:
      - modules/vendor
    -> offenses reported: 2   (same project, same broken page)

The empty string survives YAML loading — confirmed, `config.ignore` comes back as
`["node_modules","","modules/vendor"]` — and reaches `rewrite('')`. It is not anchored, so
`anyDepth('')` produces `**/{,/**}`, which matches every subject. Affects the TOP-LEVEL list and a
per-check list alike; the per-check validation in `read-yaml.ts:202` is `every(isString)` and an
empty string is a string.

Whitespace-only entries (`" "`, `"\t"`) do NOT do this — they match nothing, which is harmless.
Only a truly empty string.

REACHABLE BY ORDINARY MEANS: a half-deleted line, a commented-out entry leaving `- ""`, a
templated config. The cost is that every check in the project falls silent while the build stays
green — the failure mode `ignore.ts`'s own docblock calls "a suppression nothing reports".

THE FIX IS A DESIGN CHOICE, and it should be made deliberately rather than defaulted into. An
empty entry can be REFUSED (the config fails to load, naming the offending index) or DROPPED (the
entry is discarded and the rest of the list still applies). Refusing surfaces the typo; dropping
keeps a working config working. Whichever is chosen, the one unacceptable outcome is the current
one. Record the choice where the next reader will find it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An empty-string entry in the TOP-LEVEL `ignore` list no longer causes any file to be ignored on account of that entry
- [x] #2 The same holds for an empty-string entry in a per-check `ignore` list
- [x] #3 The other, valid entries in the same list still apply — a malformed entry must not take the working ones with it, whichever of refuse-or-drop is chosen
- [x] #4 A control asserts that a project with a genuine offense still reports it when the config carries an empty entry, so the test cannot pass by ignoring nothing at all
- [x] #5 Whitespace-only entries keep their current harmless behaviour, or the change to them is deliberate and stated
- [x] #6 The refuse-or-drop decision is recorded in a comment at the code that implements it, with the reason
- [x] #7 SABOTAGE-VERIFIED: reverting the fix makes the new test fail; the revert is undone afterwards and the suite is green
- [x] #8 platformos-check-common and platformos-check-node suites pass, plus type-check and format:check
- [x] #9 A changeset accompanies the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settle refuse-vs-drop by measuring the precedent the module claims to follow, rather than by preference.
2. Fix at the single choke point both lists pass through, so one filter covers the global list, every check's own list, and every runtime.
3. Two tests: the fix with controls either side of the blank entry, and the degenerate all-blank list.
4. Sabotage, then re-run the end-to-end proof that found the defect — with a control that is not vacuous.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECISION: DROP, not refuse — and it is not a preference. `ignore.ts` states it implements `.gitignore` semantics, so the precedent was measured rather than recalled: a real `.gitignore` carrying a blank line was run through `git check-ignore`, and git applies the surrounding patterns and ignores nothing extra. Refusing the config would also be a hard failure for a cosmetic typo, and in the language server would take the whole editor session with it.

WHERE: `compiled()` in `ignore.ts`, one `.filter` before `rewrite`. That function is the single choke point for the global list AND every check's own list, and it lives in check-common, so node, browser and the language server all inherit the fix. Filtering in check-node's `read-yaml.ts` would have covered the per-check list only, on one runtime.

SCOPE HELD DELIBERATELY NARROW: only `''` is dropped. A whitespace-only entry is still compiled and still matches nothing, which is the pre-existing harmless behaviour; the test pins that boundary by carrying `' '` in the same fixture, so a later 'improvement' that trims will have to be deliberate.

A SIDE EFFECT WORTH KNOWING: a list holding nothing but blanks now compiles no matcher, so `hasIgnorePatterns` returns false where it used to return true. That is correct — there was never anything to match — and it lets callers keep their fast path. Asserted directly rather than left to be discovered.

SABOTAGE: removing the `.filter` fails exactly the two new tests; the other 23 in the file pass either way, so no previously-asserted behaviour moved.

END TO END, real config through the real loader and `check()`, on a project with a broken page in `app/views/pages` and another in `modules/vendor/public/views/pages`:

    no ignore at all (baseline)      4 offenses, both files
    blank entry + modules/vendor/**  2 offenses, app page only
    same, blank entry removed        2 offenses, app page only   <- identical, so the blank does nothing
    ONLY a blank entry               4 offenses, both files      <- was 0 before the fix

MY FIRST e2e FIXTURE WAS VACUOUS and I caught it in the results, not by inspection: the ignored file was at `modules/vendor/lib.liquid`, which is not a platformOS source path, so it was never linted and the 'no ignore' baseline showed the same count as the ignored run. Moving it to `modules/vendor/public/views/pages/lib.liquid` made the control real — the baseline now shows 4 against 2.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A blank entry in an `ignore` list is now skipped before it is compiled, instead of becoming a match-everything pattern that silenced the entire project.

**The defect.** `rewrite('')` produced a pattern matching every subject, so one stray `- ""` in `.platformos-check.yml` made `check()` return no offenses at all. The run exited clean with nothing to say why — the worst shape a defect in this code can take, since an ignored file produces no offense for anyone to miss.

**The fix** is one `.filter` in `compiled()`, chosen as the site because it is the single choke point for the top-level list, every check's own list, and every runtime that consumes check-common.

**Drop rather than refuse, on evidence.** The module states it implements `.gitignore` semantics, so the precedent was measured: a real `.gitignore` with a blank line, run through `git check-ignore`, applies the surrounding patterns and ignores nothing extra. Refusing would also turn a cosmetic typo into a hard config failure, and into a dead language-server session.

**Tests.** Two in `ignore.spec.ts`. The first pins that a blank entry ignores nothing while the entries either side of it still do their job — controls in the same equality, so it cannot pass against code that stopped ignoring altogether. It also carries a whitespace-only entry to fix the boundary: only a truly empty entry is skipped. The second covers the degenerate list, asserting no matcher is compiled at all and `hasIgnorePatterns` reports nothing to match.

**Verification.** Sabotage: removing the filter fails exactly the two new tests, and the 23 pre-existing tests pass either way. End to end through the real loader and linter, a config with only a blank entry now reports 4 offenses where it reported 0, and a config with a blank entry alongside `modules/vendor/**` reports exactly what the same config without the blank reports. check-common + check-node 2013/2013 across 124 files, type-check clean for both, repo-wide `format:check` clean. Changeset added.

**Follow-on unchanged:** 102.3 should adopt the same drop-not-refuse decision for `null` and non-string elements, which is now settled and recorded at the code.
<!-- SECTION:FINAL_SUMMARY:END -->
