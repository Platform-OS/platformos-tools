---
id: TASK-102
title: >-
  The ignore list mishandles four kinds of pattern — one of them silences the
  whole project
status: Done
assignee: []
created_date: '2026-09-04 11:31'
updated_date: '2026-09-04 13:22'
labels:
  - bug
  - platformos-check-common
  - ignore
  - correctness
dependencies: []
references:
  - packages/platformos-check-common/src/ignore.ts
  - packages/platformos-check-common/src/ignore.spec.ts
  - packages/platformos-check-node/src/config/resolve/read-yaml.ts
  - .changeset/anchor-ignore-patterns-on-the-project-root.md
priority: high
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`isIgnored` (`platformos-check-common/src/ignore.ts`) decides which files any check is allowed to report on. Four inputs a real `.platformos-check.yml` can carry are handled wrongly. They are grouped because they live in one function's pattern handling and share two root causes, but each is independently deliverable.

MEASURED END TO END, not read off the source. A real config file through the real loader and `check()`, on a project whose one page has a broken filter:

    ignore list has an empty entry      -> offenses reported: 0
    same project, empty entry removed   -> offenses reported: 2

ROOT CAUSE 1 — NOTHING VALIDATES AN INDIVIDUAL PATTERN. Entries go from YAML into `rewrite()`
untouched. An empty string becomes a match-everything pattern (subtask .1); a YAML `null` from a
bare `-` reaches `.startsWith` and throws (subtask .3). The top-level `ignore` is typed
`string[]` and never checked at runtime; the per-check list has `every(isString)` in
`read-yaml.ts:202`, which reacts to one bad element by discarding the WHOLE list.

ROOT CAUSE 2 — "THE SUBJECT IS ALWAYS A FILE" WAS APPLIED TO ONE BRANCH ONLY. `anyDepth`
appends `{,/**}` so a bare name covers a directory's CONTENTS, and
`.changeset/anchor-ignore-patterns-on-the-project-root.md` states that reasoning explicitly. The
anchored branch (`rewrite` -> `widen`) never got it, so `modules/vendor` matches only a file of
that exact name and therefore nothing at all (subtask .2). Subtask .4 is a narrower miss in the
same family.

WHY THIS MATTERS MORE THAN AN ORDINARY BUG: an ignored file produces no offense for anyone to
miss. `ignore.ts`'s own docblock names the hazard — "a suppression nothing reports". The prior
anchoring change was made for exactly this reason, after a page with six offenses, two of them
errors, produced zero diagnostics in an editor.

HOW THESE WERE FOUND, and what an implementer needs: a local Stryker run over check-common
pointed at the pattern-rewriting code; the defects came from then RUNNING that code against the
patterns a user would write, not from the tool. Stryker is not part of this repository and is not
needed to fix any of this — every subtask states its measurement and the input that reproduces it.

SEPARATELY, AND NOT IN THIS GROUP: the spec never gives `isIgnored` more than one pattern, so the
OR across the list is unasserted — `.some` can be changed to `.every` in both places with all 23
tests green. Whoever takes subtask .1 or .2 will be writing multi-pattern fixtures anyway and
should fold that in; it is called out here so it is not lost.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED WITH 102.4 STILL OPEN, deliberately and on instruction. Three of four subtasks are Done; 102.4 (a bare pattern does not reach inside a dot-directory) was deferred as the lowest-value item with the widest blast radius — `dot: true` widens EVERY pattern in every config, including the factory defaults. It keeps its measurement and its warning, so it can be picked up without re-deriving anything. Worth promoting to a standalone task at some point so it is not filed under a closed parent.

BOTH ROOT CAUSES NAMED IN THE DESCRIPTION ARE NOW ADDRESSED:
  no validation of an individual entry -> one filter in `compiled()`, covering blank (102.1) and non-string (102.3) entries, for both lists and every runtime
  "the subject is always a file" applied to one branch only -> `withContents` (102.2) applies it to the anchored branch too

The first root cause turned out to be one line rather than two sites, because 102.3's premise about `read-yaml.ts` discarding the per-check list was wrong — measured, not assumed.

The test-side counterpart, TASK-103, is also Done and committed (353295a): the OR across a multi-pattern list is now asserted for both lists, which nothing in the 461-line spec had ever exercised.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three of the four ignore defects are fixed; the fourth is deferred by decision, not forgotten.

**What shipped**

- **102.1** — a blank entry no longer matches every file. This was the serious one: one stray `- ""` made a whole project's run report clean while checking nothing. Dropped rather than refused, on the precedent measured from git itself, which skips a blank `.gitignore` line and applies the surrounding patterns.
- **102.3** — a malformed entry (`null` from a bare `-`, `undefined`, a number, a nested list) no longer throws out of the entire run. Widened the same filter rather than adding a second site.
- **102.2** — `ignore: [modules/vendor]` now ignores that directory instead of matching nothing at all, via a `withContents` helper that applies to the anchored branch the reasoning `anyDepth` already applied to bare names. `{,/**}` rather than `/**`, so a prefix-sharing sibling stays linted.

Total source change across all three: one `.filter` and one small helper in `ignore.ts`. No other file was touched.

**Deferred — 102.4**, a bare pattern not reaching inside a dot-directory. Lowest value, widest blast radius: `dot: true` would widen every pattern in every config including the factory defaults, and platformOS sources live under `app/` and `modules/`. Its measurement and its warning are recorded, so it costs nothing to resume.

**What made this group tractable** was measuring before writing, twice over. 102.3's premise about the per-check list being silently discarded was wrong — the `Object.entries` loop above the guard already copies it — which collapsed a two-site fix to one line. And 102.2's fix was chosen by running candidate rewrites against a truth table with real `Minimatch`, picking the one that leaves every already-working spelling's compiled pattern byte-identical rather than merely behaviourally equal.

**Every fix was verified end to end** through the real config loader and `check()` on a real project, not only in unit tests — including a prefix-sharing sibling as a live control for 102.2, and a non-vacuous baseline row after the first attempt at one turned out to be testing a file the linter never looks at.
<!-- SECTION:FINAL_SUMMARY:END -->
