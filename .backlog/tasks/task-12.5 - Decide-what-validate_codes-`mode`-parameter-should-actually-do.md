---
id: TASK-12.5
title: Decide what validate_code's `mode` parameter should actually do
status: To Do
assignee: []
created_date: '2026-07-29 04:17'
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
- [ ] #1 A decision is recorded on the list above (drop / keep reserved / give real meaning) with its rationale
- [ ] #2 The tool's input schema description matches what the parameter actually does — no advertised behaviour that the handler does not implement
- [ ] #3 If the parameter keeps a no-op form, a test asserts `full` and `quick` return identical results for the same input
- [ ] #4 If the parameter is given real meaning, the difference in returned diagnostics between modes is documented and covered by tests
<!-- AC:END -->
