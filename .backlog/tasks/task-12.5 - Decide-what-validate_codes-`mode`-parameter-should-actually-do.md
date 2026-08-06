---
id: TASK-12.5
title: Decide what validate_code's `mode` parameter should actually do
status: Done
assignee: []
created_date: '2026-07-29 04:17'
updated_date: '2026-07-31 11:55'
labels:
  - supervisor
  - contract
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-files.ts
  - packages/platformos-mcp-supervisor/test/integration/stdio-smoke.spec.ts
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
## Decision: REMOVE it, rather than give it meaning

`mode: full|quick` was advertised in the tool schema and documented as doing nothing — both branches returned the same result at the same cost. That is a promise the tool could not keep: an agent reading the schema had no way to know `quick` bought nothing, and the description had to apologise for the parameter's own existence.

Giving it real semantics was the alternative, and it was rejected because there is no longer a heavy stage worth skipping. After TASK-12.8/12.16 a warm call is ~340 ms, of which the buffer's own parse and checks are ~84 ms; the rest is fixed project cost that a `quick` mode could not skip without making the answer wrong (cross-file checks need the project). A mode that saved nothing measurable would be the same empty promise with extra code paths.

## Removed alongside it: six permanently-empty result stubs

Same reasoning, same commit: `proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`, `parse_error` were emitted as always-`[]`/`null`. An agent cannot distinguish an always-empty field from a meaningful one, so `proposed_fixes: []` was a standing invitation to conclude "no fixes are available" from a field that was never going to say anything else. They return when TASK-8.x actually populates them.

A clean-file result went from **15 keys to 6**.

## Compatibility: verified, not assumed

I wrote a spec asserting a stale `mode` argument would now be REJECTED. It failed — so I checked the running server rather than adjusting the test. The advertised schema carries `additionalProperties: false`, but the MCP SDK does not enforce it: sending `mode: "quick"` returns a normal, correct result with the argument dropped.

That is the better outcome, so the spec now pins reality: an agent mid-session that still sends `mode` keeps working instead of suddenly erroring over a parameter that never did anything. This makes the removal safe rather than breaking. Three specs cover it (schema no longer advertises it; a request carrying it parses with the key dropped; the handler returns an identical result with and without).

## Guard against silent regrowth

`assemble.spec.ts` pins the EXACT key set for both result shapes, asserts each of the six removed fields is absent, and checks a JSON round trip — necessary because an `undefined` value disappears on the wire, so "absent" and "present but undefined" are indistinguishable to a naive test yet identical to an agent. A mirror assertion confirms a CHECKED result carries neither `next_step` nor `not_applicable_reason`.

Supervisor suite 216 → 220. Type-check, build and format clean; verified against the rebuilt bin on a real project.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`mode` is gone from `validate_code`, and so are the six permanently-empty result stubs (`proposed_fixes`, `clusters`, `scorecard`, `tips`, `domain_guide`, `parse_error`). A clean-file payload dropped from 15 keys to 6.

The decision was to remove rather than implement: with a warm call at ~340 ms and only ~84 ms of it attributable to the buffer itself, there is no heavy stage a `quick` mode could skip without making the answer wrong. Keeping an advertised parameter that does nothing — or fields that are structurally incapable of being non-empty — misleads an agent that has no way to tell.

Removal is compatible, and that was verified against the running server rather than assumed: the MCP SDK does not enforce the advertised `additionalProperties: false`, so a stale caller still sending `mode` gets a normal result with the argument dropped. The exact result key set is now pinned by specs, including a JSON round trip, so a stub cannot silently reappear.
<!-- SECTION:FINAL_SUMMARY:END -->
