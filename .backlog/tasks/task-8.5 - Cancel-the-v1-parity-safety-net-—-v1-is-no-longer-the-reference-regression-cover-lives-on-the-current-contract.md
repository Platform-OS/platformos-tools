---
id: TASK-8.5
title: >-
  Cancel the v1-parity safety net — v1 is no longer the reference; regression
  cover lives on the current contract
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
updated_date: '2026-08-16 12:07'
labels: []
dependencies:
  - TASK-7.11
references:
  - packages/platformos-mcp-supervisor/src/result/assemble.spec.ts
parent_task_id: TASK-8
priority: medium
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## CANCELLED 2026-08-16 — do not build this

This task asked for a parity suite comparing the rebuilt `validate_code` against 13
captured v1 baselines, with tolerated divergences recorded in a normaliser and a divergence
registry. The reasoning was: "proving functionality intact requires comparing the new output
to the old output, not just snapshotting the new output."

That reasoning was sound while v1 was the reference. It no longer is.

**The v1 contract has been deliberately contradicted in at least eight places**, every one
of them a decision taken since these baselines were captured: six result fields removed by
TASK-12.5 (`proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`, `parse_error`),
the `mode` parameter removed, the `pos-supervisor:` advisory namespace abolished, hint prose
abolished, and the per-domain layer dissolved. A parity run would fail on all of them, and
the divergence registry meant to hold the exceptions would end up restating the entire
revision. A registry that lists every field is not a safety net — it is a second copy of the
changelog that fails whenever the contract legitimately moves.

Worse, it would exert quiet pressure in the wrong direction. A suite whose passing condition
is "looks like v1" makes every deliberate improvement show up as a failure to be explained
away, and the cheapest way to make it green is to put the defect back.

## Where the coverage actually goes

**Regression cover on the CURRENT contract → TASK-7.11**, which already owns fresh
baselines against the shipped `ValidateCodeResult`, and where `assemble.spec.ts` already
pins the exact key set including the absence of every removed field. That is a real safety
net: it fails when the contract moves without anyone deciding it should.

**The corpus fixtures → TASK-7.11 as well.** The 26-file project and 43-file broken-project
fixtures are still wanted as INPUT; recover them with
`git checkout 69aa9e4 -- docs/mcp-supervisor/salvage` and take `fixtures/` only. The 13
`<NN>-<slug>.expected.json` baselines are NOT recovered — they encode the v1 shape, and a
stale baseline in the tree is an invitation to restore it.

## If you are here because you want confidence the rebuild did not lose something

The honest form of that question is not "does it match v1" but "does it still catch what it
used to catch". That is answered per capability, at the point each was re-homed: TASK-7.13
requires every removed instruction claim to be shown still caught by the check that owns it,
TASK-8.2 and TASK-8.3 require a disposition per entry, and TASK-7.8 requires a measured
false-positive rate per ported detector. Those are the safety net, distributed to where the
evidence is.

Archive this task once TASK-7.11 has landed and the fixtures are in the package tree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No v1-parity suite, normaliser or divergence registry is added to the repository
- [ ] #2 The 13 v1 .expected.json baselines are not restored to the tree
- [ ] #3 The salvaged corpus fixtures are recovered into the package test tree under TASK-7.11, and this task is archived once that lands
- [ ] #4 Regression cover for the result contract exists on the CURRENT shape via TASK-7.11 and the exact-key-set guard in assemble.spec.ts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## NOTE — salvage material untracked from git (2026-06-12)

The 13 captured v1 parity baselines + corpus + `OLD-parity-spec.ts` live under `docs/mcp-supervisor/salvage/`, which was UNTRACKED from git (`git rm -r --cached` + `.gitignore`) to keep PRs small. Recover them from history when starting this task:

    git checkout 69aa9e4 -- docs/mcp-supervisor/salvage

(commit `69aa9e4`). The baselines/corpus should then be restored into the package test tree (see TASK-7.11).
<!-- SECTION:NOTES:END -->
