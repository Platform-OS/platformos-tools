---
id: TASK-102.2
title: >-
  A directory pattern with a slash and no trailing slash ignores nothing —
  `modules/vendor` is a no-op
status: Done
assignee: []
created_date: '2026-09-04 11:32'
updated_date: '2026-09-04 12:21'
labels:
  - bug
  - platformos-check-common
  - ignore
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.ts
  - .changeset/anchor-ignore-patterns-on-the-project-root.md
modified_files:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-common/src/ignore.spec.ts
  - .changeset/ignore-a-bare-anchored-directory-and-its-contents.md
parent_task_id: TASK-102
priority: medium
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ignore: [modules/vendor]` has no effect whatsoever. The bare equivalent `vendor` works, and so do `modules/vendor/`, `modules/vendor/*` and `modules/vendor/**`. Only the plain anchored directory path silently does nothing.

MEASURED, one pattern per config, against `modules/vendor/lib.liquid`:

    vendor              -> ignored
    modules/vendor      -> NOT ignored      <-- the defect
    modules/vendor/     -> ignored
    modules/vendor/*    -> ignored
    modules/vendor/**   -> ignored

`app/views/pages` behaves the same way against `app/views/pages/x.liquid`.

WHY. The subject handed to a matcher is always a FILE path. `anyDepth` accounts for that by
appending `{,/**}`, so a bare name covers a directory's contents as well as a file of that name —
and `.changeset/anchor-ignore-patterns-on-the-project-root.md` states that reasoning in as many
words. The anchored branch in `rewrite()` relies on `widen()` instead, whose regex `/\/\*?$/` only
fires on a trailing `/` or `/*`. A pattern ending in a bare directory name is left alone, compiles
to a matcher for that exact path, and therefore matches no file ever. The principle was applied to
one of the two branches.

`.gitignore`, which this deliberately imitates, ignores the directory AND its contents for
`modules/vendor`.

DIRECTION OF HARM is the safe one — files get checked that the user asked to skip, so they see
noise rather than silence. It is filed as a real defect anyway because the feature does nothing
and says nothing, and the workaround (add a slash) is undiscoverable.

WATCH THE PREFIX TRAP when fixing: covering the contents of `modules/vendor` must not start
matching a SIBLING whose name merely begins the same way, such as `modules/vendor-extras/x.liquid`
or `modules/vendorx.liquid`. That is the failure mode a naive `pattern + '**'` introduces, and it
would silence first-party files — the exact class the anchoring change was made to stop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ignore: [modules/vendor]` ignores `modules/vendor/lib.liquid` and `modules/vendor/deep/lib.liquid`
- [x] #2 A sibling whose name merely shares the prefix is NOT ignored — `modules/vendor-extras/x.liquid` and `modules/vendorx.liquid` are still checked
- [x] #3 Anchoring is preserved: `modules/vendor` does not ignore `app/modules/vendor/lib.liquid`, the property the prior anchoring change exists to protect
- [x] #4 The four spellings that already work — `vendor`, `modules/vendor/`, `modules/vendor/*`, `modules/vendor/**` — keep their current behaviour, asserted in the same table so a regression in any of them is visible
- [x] #5 A leading-slash pattern (`/modules/vendor`) gets the same treatment as the slash-bearing one, since `rewrite` routes both to the anchored branch
- [x] #6 SABOTAGE-VERIFIED: reverting the fix makes the new assertions fail; the revert is undone afterwards and the suite is green
- [x] #7 platformos-check-common and platformos-check-node suites pass, plus type-check and format:check
- [x] #8 A changeset accompanies the change, and states the behaviour change for a config that currently writes a bare anchored directory
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Do not reason about the fix — enumerate candidate rewrites against a truth table driven by real `Minimatch`, including the prefix-sharing siblings the task warns about.
2. Pick the candidate that leaves every currently-working spelling's COMPILED pattern byte-identical, not merely behaviourally equal.
3. Diff before/after compiled output for every pattern shape, to see exactly which change and which only change cosmetically.
4. One table test covering the fix and the four working spellings together; sabotage both the fix and the prefix guard; then end to end with the sibling as a live control.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THE FIX WAS CHOSEN BY MEASUREMENT, not design taste. Two candidates satisfied the truth table:
  B  mirror `anyDepth` exactly: `trimTrailingSlash(p) + '{,/**}'`, dropping `widen` from the anchored branch
  A  `widen` first, then cover only when the result does not already end in a glob
Both produced identical match results on every row. A was chosen because it leaves the COMPILED PATTERN byte-identical for `modules/vendor/`, `modules/vendor/*`, `modules/vendor/**` and every bare name, so regression risk for the spellings that already worked is structurally zero rather than merely tested. B rewrites three working spellings to reach the same answers, which is a larger bet for no gain.

BEFORE/AFTER OVER EVERY PATTERN SHAPE, compiled output compared directly:
  results changed: `modules/vendor`, `/modules/vendor`, `app/views/pages`  <- the three broken bare-anchored spellings, and only those
  compiled changed but results did NOT: `app/views/pages/*.liquid`, which now carries a harmless `{,/**}`
  untouched: `modules/vendor/`, `/*`, `/**`, `vendor`, `node_modules`, `*.liquid`

THE HELPER IS NAMED `withContents`, NOT `anchored`, because `isAnchored` already exists and returns a boolean; two near-identical names differing only in return type is a reading hazard. `widen` is kept and composed rather than absorbed, so the `foo/` and `foo/*` rule keeps its own docblock.

TWO SPEC ASSERTIONS NEEDED UPDATING, and they are the reason to be careful here rather than fast: `should compile each pattern exactly once per config` and `should compile the global patterns once and the per-check patterns once` pin the exact `Minimatch` constructions, and `app/views/partials/*.liquid` now compiles with `{,/**}` appended. That is a genuine change to the compiled string whose matching behaviour was measured to be unchanged — updated deliberately, not to make a red test green. The two rows at lines 391/392 end in `*` and were correctly unaffected.

SABOTAGE, both directions that matter:
  `withContents` reduced to plain `widen` (the defect back)  -> the new table fails
  `{,/**}` replaced with `**` (the prefix trap)              -> the new table fails

END TO END, real config through the real loader and `check()`, three broken pages, with a prefix-sharing sibling as the control:
  no ignore (baseline)        6 offenses  app/views, modules/vendor, modules/vendor-extras
  ignore: modules/vendor      4 offenses  app/views, modules/vendor-extras   <- was 6; sibling still linted
  ignore: modules/vendor/**   4 offenses  identical, so the bare form now matches the documented form
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`ignore: [modules/vendor]` now ignores that directory instead of matching nothing at all.

**The defect.** The subject handed to a matcher is always a file, so an anchored pattern ending in a plain directory name compiled to a matcher for a *file* of that exact name and never fired. `vendor`, `modules/vendor/`, `modules/vendor/*` and `modules/vendor/**` all worked — only the most obvious spelling silently did nothing, with an undiscoverable workaround.

**The fix** is a `withContents` helper used by both anchored branches of `rewrite`: widen as before, then append `{,/**}` when the result does not already end in a glob. It applies to the anchored branch the same reasoning `anyDepth` already applied to bare names, and the two now share the intent if not the code path.

**Chosen by measurement.** Two candidates satisfied the truth table identically; the one adopted leaves the compiled pattern byte-identical for every spelling that already worked, so those carry no regression risk by construction. A before/after sweep over every pattern shape confirms results change for exactly the three broken spellings and nothing else.

**`{,/**}` rather than `/**` is the prefix guard** the task warned about: `modules/vendor` covers the directory and its contents without sweeping in `modules/vendor-extras` or `modules/vendorx.liquid`. Anchoring is untouched — it still leaves the first-party `app/modules/vendor` linted.

**Verification.** One table test asserts the fix and the four working spellings together, so a regression in any of them surfaces in the same place; an unanchored row rides along as the contrast that proves anchoring still holds. Sabotage in both directions — reverting the fix, and swapping the guard for a plain `**` — each fails that table. Two pre-existing assertions that pin exact `Minimatch` constructions were updated deliberately, the compiled string having genuinely changed for one pattern whose behaviour was measured not to. End to end on a real project with a prefix-sharing sibling as control: 6 offenses before, 4 after, the same 4 that `modules/vendor/**` produces. check-common + check-node + platformos-common 2604/2604 across 144 files, type-checks clean, repo `format:check` clean.

**Changeset is `minor`, not `patch`,** and says so plainly: a config already writing a bare anchored directory will start ignoring it and report fewer offenses. That is what the pattern always meant, but it does change lint output for existing users, which the prior anchoring change treated the same way.
<!-- SECTION:FINAL_SUMMARY:END -->
