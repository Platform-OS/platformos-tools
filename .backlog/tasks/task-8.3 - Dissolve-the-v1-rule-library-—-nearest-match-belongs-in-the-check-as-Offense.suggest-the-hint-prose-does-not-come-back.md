---
id: TASK-8.3
title: >-
  Dissolve the v1 rule library — nearest-match belongs in the check as
  Offense.suggest, the hint prose does not come back
status: To Do
assignee: []
created_date: '2026-06-09 15:56'
updated_date: '2026-08-16 12:06'
labels: []
dependencies:
  - TASK-7.7
references:
  - packages/platformos-check-common/src/checks
  - packages/platformos-check-common/src/fixes
  - packages/platformos-graph
parent_task_id: TASK-8
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## This task was INVERTED on 2026-08-16

It previously said: port v1's 32 rule modules / 92 rules into the supervisor's `enrich/`
stage — hint prose selected from `data/hints/<Check>[-variant].md`, variant selection,
did-you-mean, confidence, `see_also`, fix translation. **Do not port it.** Three of its six
pieces are now forbidden, two are already owned by TASK-7.7, and the one that is genuinely
valuable belongs in a different package.

## Piece by piece

**Hint prose from `data/hints/*.md` — FORBIDDEN.** TASK-7's invariant 6: the supervisor
ships no documentation. Explanation comes from check-common `meta.docs` and from rendering
the docset entry. TASK-7.7 already does both.

**Variant selection (`MissingPartial-invalid_lib_prefix` vs `-module` vs
`-suggest_nearest`) — FORBIDDEN, and unnecessary.** A "variant" is a different paragraph of
prose for the same finding. With no prose to select between, there is nothing to select. If
a check genuinely reports three distinguishable situations, those are three messages the
CHECK should emit, decided where the evidence is, not re-derived downstream.

**`{{var}}` substitution — gone with the prose.**

**Confidence and fix translation — already TASK-7.7's**, and scoped there more tightly:
fixes are produced by running the engine's own `Fixer` through check-common's
`StringCorrector`, never regenerated; confidence ships only if it can be derived from
something real. Do not write a second implementation here.

**did-you-mean / nearest-match — the one genuinely valuable piece, and it belongs in
check-common.** `Offense.suggest` already exists and **18 checks already populate it**
(`valid-frontmatter`, `translation-key-exists`, `unused-assign`, `deprecated-filter`,
`variable-name`, `missing-doc-param`, `valid-filter-argument-types`, and more). A check has
the docset and the `App` index right there; the supervisor does not know better from
further away. Computing a nearest match in the supervisor would be a second implementation
of a thing the engine already does, reachable by every consumer — editor, CLI, browser —
only if it lives in the check.

## What to actually do

Audit which checks that *could* offer a nearest match do not. Likely candidates:
`UnknownFilter` (nearest published filter name from the docset), `MissingPartial` /
`MissingPage` / `MissingAsset` (nearest existing target from the `App` index or
`platformos-graph`), `UndefinedObject` (nearest documented object). For each, either add
`suggest` in the check or record why it should not — a wrong "did you mean" is worse than
none, because an agent will act on it.

Then confirm the supervisor passes `suggest` through (TASK-7.6 carries it, TASK-7.7 maps
it) and adds nothing of its own.

## Do not

- Create any per-check rule module, rule registry, or hint table in the supervisor.
- Compute a nearest match in the supervisor, from any index.
- Reintroduce the analytics / case-base / adaptive-confidence machinery — permanently out
  of scope since the v1 migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The supervisor contains no rule module, rule registry, hint table or variant selector, and computes no nearest match of its own
- [ ] #2 Every check that could offer a nearest match either populates Offense.suggest or has a recorded reason not to, in a committed audit table
- [ ] #3 Each newly added suggest is measured on the real projects in ~/projects/pos for how often its top candidate is the right one, and the numbers are recorded before it ships
- [ ] #4 Newly added suggestions are pinned by check-common unit specs asserting the whole offense, and reach the agent surface unchanged through the supervisor
- [ ] #5 No analytics, case-base or adaptive-confidence machinery is reintroduced
<!-- AC:END -->
