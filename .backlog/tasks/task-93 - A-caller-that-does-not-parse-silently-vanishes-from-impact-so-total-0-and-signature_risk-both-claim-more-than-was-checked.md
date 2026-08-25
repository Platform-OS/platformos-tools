---
id: TASK-93
title: >-
  impact reports findings only: the caller count is removed and signature_risk
  is never an empty all-clear
status: Done
assignee: []
created_date: '2026-08-24 16:50'
updated_date: '2026-08-25 10:53'
labels:
  - mcp-supervisor
  - contract
  - false-approval
  - impact
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - packages/platformos-mcp-supervisor/src/impact/project-scan.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - /home/ecgtheow/Work/supervisor-tests/auto-eval/suites/16-impact.mjs
priority: high
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`incomingReferences()` resolves candidates through `extractFileReferences`, which needs an AST. A candidate that does not parse therefore contributes NO edges — and nothing downstream records that a candidate was skipped. The count is a LOWER BOUND whenever any candidate failed to parse, but it is reported as a total, and two affirmative claims are built on it.

MEASURED against the current build (auto-eval suite `16-impact`, deterministic 5/5, collateral 0).

SYMPTOM A — `computed` + `total: 0`, which the server documents as its ONE affirmative.

A 10-file changeset in a single call, p(n) rendering p(n+1). With every file parsing, each of p1..p9 correctly reports `total: 1` and p0 correctly reports 0 — the changeset overlay works. Appending `{% if %}` to p4, leaving its `{% render 'p5' %}` untouched:

    p5:  total 1 -> 0,  status still `computed`,  p4 file_status=error,  no other row moves

`SERVER_INSTRUCTIONS` says: "its zeroed counts are NOT a claim that nothing depends on the file. Only `status: computed` with `total: 0` says that." So the server makes the one claim it reserves for certainty, and it is false: p4 depends on p5, it just does not parse. An agent reads it as safe to delete or re-signature.

SYMPTOM B — `signature_risk: []`, the unearned all-clear TASK-85 exists to prevent.

Callee ON DISK with a `{% doc %}` required param, its only caller ON DISK unparseable:

    total=0, signature_risk=[]        <- "checked, every caller matches"
    CONTROL, caller parses: total=1, signature_risk names it missing_required:["title"]

TASK-85 gates the affirmative on `dependents.length > 0 || existsOnDisk(fileUri)`. Both holes it closed are real; this is a THIRD way for no caller to be visible, and the on-disk test passes, so the affirmative is emitted. The task is not wrong — its stated bound ("no caller was visible to check") is wider than its implementation.

BOUND, measured:
- It is UNPARSEABLE, not "unhealthy". A caller carrying a blocking lint error that still parses keeps its edge (`total: 1`) — verified as a control, because if that had also dropped the defect would be a different, wider one.
- `render` and `include` both affected. `function`/`background` were NOT probed against a partial: they resolve under `app/lib/`, so a first pass measuring `total: 0` for them was a FIXTURE ERROR, not a finding.

WHY THIS IS NOT "WORKING AS DESIGNED": the graph genuinely cannot see edges in a file it cannot parse, and that is fine. What is not fine is reporting the result as a total and letting two affirmatives rest on it. The honest answers are a distinct status (the count is partial), or withholding the affirmative the way TASK-85 already does for one of the two causes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `dependents` is removed from `ValidateCodeImpact`. No caller count, sample or per-kind breakdown is published, so the `computed` + `total: 0` affirmative that symptom A defeated no longer exists to be defeated
- [x] #2 `signature_risk` is present ONLY when non-empty. The empty array of symptom B is never emitted — proven at the wire level, where `JSON.stringify` would hide an `undefined`
- [x] #3 A caller that parses but carries a blocking lint error STILL contributes a finding, while an unparseable one does not — asserted as one paired test, and each half proven non-vacuous by flipping the fixture
- [x] #4 The cheap question is asked first: a buffer declaring no `{% doc %}` block reads no project text at all, asserted against a scan that throws when consulted, with a contract-bearing control that must read it
- [x] #5 A non-Liquid buffer is not parsed to discover it has no contract — pinned as a cost claim against the parse it avoids as the control, since no returned value can observe it
- [x] #6 SERVER_INSTRUCTIONS and the `ValidateCodeImpact` docblock state that nothing impact returns is a clearance, and that the server never answers "who depends on this file"
- [x] #7 The caller set's undecidability is itself a test: a caller naming the partial through a variable is invisible, with a literal caller as the control
- [x] #8 Sabotage in both directions: 11 rounds against `impact.ts` and the instructions, each confirmed to fail the intended test and only that test
- [x] #9 A changeset accompanies the change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PROVENANCE, corrected. Symptom A is NOT a new discovery. It was found, confirmed and written up as
`S09-EDGE-LOST` in the auto-eval round of 2026-08-17 ("a caller the parser cannot parse silently
loses its edge, and `impact` still answers `computed`"), classified there as a missed detection, and
never filed as a task. It read as new in the 2026-08-24 round because the eval's own registry
ingested only round-6 findings — its `roundFiles` scan computed a list of prior FINDINGS files and
used it for nothing — so no machine round was in the machine's memory. That has been fixed
(`registry/build-known.mjs` now ingests `results/<tag>/*.json`), and `S09-EDGE-LOST` now carries
`first_seen: 2026-08-17`.

What the 2026-08-24 round DID add to symptom A is bound, not existence: the ten-file changeset
shape, the control proving it is parseability rather than health, and the per-kind sweep.

SYMPTOM B IS NEW. `signature_risk` was explicitly unprobed before this round (09-graph's own
left_dark said so), and TASK-85 — the fix whose affirmative this defeats — landed on 2026-08-22,
after the prior round ran. So the interaction between the known edge-loss and the new withholding
rule has not been measured before.

WHY THE PRIORITY IS STILL HIGH despite A being a year-old missed detection: the prior round ranked
it "a gap, nothing breaks". That ranking predates TASK-85. Once `signature_risk` began making an
affirmative claim, the same silent edge-loss started producing an unearned all-clear about a
CONTRACT, which is a different and worse category than a missed detection.

RESOLVED BY REMOVING THE CLAIM, not by patching the count — the AC above were rewritten to the solution actually shipped, and the original AC#1/#2 are deliberately gone.

The task as filed proposed a partial-count status. That was the wrong fix. An unparseable caller is not one hole among two or three; it is one instance of the general fact that a file's caller set is UNDECIDABLE. Measured here: `{% render var %}`, `{% include var %}`, `{% function r = var %}` and an assigned variable all parse, and none yields an edge any static resolver can follow — a partial called once by literal and once through a variable was reported as having exactly one dependent. So TASK-85's `existsOnDisk` gate, symptom A's parse failure and symptom B's empty array were three symptoms of one mistake: publishing a number that can only ever be a lower bound, to an audience that reads it as a total.

What shipped instead:
  - `dependents` deleted outright. Its positive half was redundant (`signature_risk` already names the callers) and its negative half was the unsound claim.
  - `signature_risk` present only when non-empty; contract text is 'callers found to mismatch; absence is not a clearance'.
  - The cheap question asked first: `docSignature` is buffer-only, so no `{% doc %}` block means no project read at all. On the measured 2,768-file app no file declares one, so that is 100% of calls — 235 ms to 0 ms, and unchanged at 10k files. This is what answers the CTO's cost objection: the expensive scan is now paid only for the one claim that is sound, and never otherwise.

TASK-85's machinery (`existsOnDisk`, `callersAreKnowable`) is therefore unnecessary and was never merged to master; the class of bug it guarded no longer exists.

AC#6 of the original (auto-eval `16-impact` reports 0 disagreements) is NOT claimable as written: suites `16-impact` and `09-graph` assert the removed `dependents` contract and must be rewritten before they can be re-run. That is follow-up work, flagged to the user rather than silently dropped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Impact now publishes findings only.

WHAT CHANGED
- `ValidateCodeImpact.dependents` removed (count, `by_kind`, `sample`).
- `signature_risk` present only when non-empty; an empty array is never emitted.
- Order flipped in `runImpact`: extension → logical name → `{% doc %}` contract (buffer-only parse) → project read. A buffer with no contract does zero project I/O.
- `existsOnDisk` / `callersAreKnowable` / `summarizeDependents` / `isGraphTrackable` deleted; `NOT_APPLICABLE_IMPACT` reused for every "nothing to compare" case.
- `SERVER_INSTRUCTIONS`, `ValidateCodeImpact`, `impact-states.ts`, `assemble.ts`, `project-scan.ts`, `context.ts`, `server.ts` and the README restated: nothing impact returns is a clearance, and the server never answers "who depends on this file". Internal "blast radius" naming retired, log strings included.

COST
235 ms project read → 0 ms on every call where the buffer declares no `{% doc %}` block, which is every file of the 2,768-file app measured. Unchanged at 10k files, since the read is skipped rather than made cheaper. The extension guard additionally avoids ~8 ms parsing an 8 KB schema YAML to discover it has no contract.

TESTS
`impact.spec.ts` rewritten (21 tests): every property of the resolver that `dependents` used to observe is now observed through `signature_risk`, so no coverage was lost. New: the cost claim measured against the parse it avoids as a control; the unparseable-caller boundary paired with a lint-broken caller that still reports; the variable-named caller that is invisible, paired with a literal control. Wire-level test proves the `signature_risk` key is absent, not empty, after a JSON round trip.

Sabotage: 11 rounds against `impact.ts` and the instructions, each confirmed to fail the intended test and only that test. Two fixture-flip probes confirm the two silence tests are not vacuous. Full monorepo suite green: 353 files, 4454 tests.

FOLLOW-UP
auto-eval suites `16-impact.mjs` and `09-graph.mjs` assert the removed `dependents` contract and need rewriting before the next round.
<!-- SECTION:FINAL_SUMMARY:END -->
