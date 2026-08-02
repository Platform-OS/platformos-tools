---
id: TASK-12.5
title: Decide what validate_code's `mode` parameter should actually do
status: Done
assignee: []
created_date: '2026-07-29 04:17'
updated_date: '2026-08-01 21:00'
labels:
  - supervisor
  - contract
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`validate_code` advertises `mode: full | quick` as an analysis-depth knob ("`full` runs the heavier ergonomic stages; `quick` is lint + enrichment"), but `assembleResult` takes it as `_mode` and ignores it: both modes do identical work and return identical results. An agent reading the schema will reasonably pass `quick` to go faster and get nothing.

As an immediate correctness fix the description was changed to say the parameter is reserved and currently has no effect, so the contract no longer promises a difference. The enum is still accepted, so nothing that already passes `mode` breaks.

What remains is a product decision, and it needs one because either answer changes the tool's diagnostics or its surface:

1. Drop the parameter until real stages exist (cleanest surface; rejects calls from agents that learned to send it).
2. Keep it reserved and no-op (status quo after this change).
3. Give it real meaning. The one distinction available cheaply is buffer-only analysis: `quick` would lint the buffer WITHOUT loading the on-disk project, skipping every cross-file check (`MissingPartial`, `MissingPage`, `OrphanedPartial`, `TranslationKeyExists`, `PartialCallArguments`). That is a genuine speed/coverage trade — worth having only if the cold-project load is still a bottleneck after TASK-12's other subtasks land, and only if a caller is expected to knowingly accept weaker checking.

Do not implement option 3 without deciding what an agent is supposed to do with a `quick` result that cannot see the rest of the project — a partial lint that hides missing-partial errors is worse than a slower complete one for a pre-write gate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded on the list above (drop / keep reserved / give real meaning) with its rationale
- [x] #2 The tool's input schema description matches what the parameter actually does — no advertised behaviour that the handler does not implement
- [ ] #3 If the parameter keeps a no-op form, a test asserts `full` and `quick` return identical results for the same input
- [x] #4 If the parameter is given real meaning, the difference in returned diagnostics between modes is documented and covered by tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DECIDED: option 3 — give `mode` real meaning (user decision, 2026-08-01)

`quick` is now the DEFAULT and is the pre-write gate; `full` adds the whole-project
checks. The axis is `singleFileOnly` from TASK-12.6.8, which is what made option 3
safe: when the description was written, "quick" could only have meant "lint the
buffer without the project", which hides `MissingPartial`/`MissingPage` — exactly the
trade the description said not to make. It no longer means that. `quick` resolves
against the whole project and withholds no correctness answer; the only thing `full`
adds is the reverse question, "is anything rendering this partial?".

| | `quick` (default) | `full` |
|---|---|---|
| checks that resolve against the project (`MissingPartial`, `MissingPage`, `TranslationKeyExists`, `PartialCallArguments`, …) | yes | yes |
| whole-project checks (`OrphanedPartial`) | no | yes |
| cost | 50-120 ms warm | + a parse of every Liquid file in the project |

### What landed

- `lintBuffer` takes `wholeProject` (runs the `single_file: false` set) and
  `getReferences` (the reverse index those checks CONSUME).
- The supervisor maps `mode` onto it and defaults to `quick`. The default flipped
  from `full`, which is the right way round for a tool called before every write.
- The input schema now describes the real distinction (AC #2), including the caveat
  below, in place of "reserved; currently ignored".

### The caveat, which is the honest part

**`OrphanedPartial` reports nothing in check-node today — in `pos-cli check` either.**
It reads `context.getReferences`, and check-node never supplied one: building a
reverse index means a dependency graph, and `platformos-graph` sits ABOVE check-node.
So `full` runs strictly more checks than `quick` and currently returns the same
diagnostics; it never returns fewer. That is stated in the tool's schema text rather
than papered over, and the plumbing is in place so the day a caller passes
`getReferences` — the supervisor, once TASK-7.6's graph-backed project context lands
— `full` starts reporting orphans with no contract change.

This was NOT known when the epic's changeset claimed a genuinely orphaned partial "is
still reported in `pos-cli check`". It is not: wiring `getReferences` into check-node
(or into `appCheckRun`'s caller) is unfinished business worth its own task.

### Tests (AC #4)

- `check-node/src/lint-buffer.spec.ts`, `wholeProject: the checks that need the rest
  of the project` (3): the orphan is reported with `wholeProject: true` AND a
  reference provider; not by default; not without a provider however whole the run.
- `supervisor/test/integration/stdio-smoke.spec.ts`: `full` and `quick` return
  identical results over the real stdio transport — the pin that has to be updated
  deliberately the day `full` starts reporting more (this also covers AC #3, which
  the "keep it a no-op" branch would have required).

Monorepo `yarn test` 296 files / 2657 tests green, `yarn type-check` clean.

## SUPERSEDED, THEN CLOSED OUT (2026-08-01) — `mode` is REMOVED

The decision recorded above gave `mode` its meaning through `singleFileOnly`. That
partition is gone with `OrphanedPartial` (TASK-29), so there is once more no work a
deeper mode could do: every check the linter has answers for one file.

So the parameter was dropped outright — option 1 from the list above, the cleanest
surface. `mode` is off `VALIDATE_CODE_INPUT`, `assembleResult` no longer takes it,
`ValidateCodeMode` and `ValidateCodeParams.mode` are deleted, and `lintBuffer` lost
`wholeProject` with the partition.

The objection to option 1 was that it "rejects calls from agents that learned to send
it". It does not: the MCP SDK validates against the declared shape and DROPS what is
not in it, so an old call still succeeds and returns the same result. That is pinned
by the stdio smoke test ("ignores a retired argument instead of rejecting the call"),
which is what makes the removal safe rather than merely tidy.
<!-- SECTION:NOTES:END -->
