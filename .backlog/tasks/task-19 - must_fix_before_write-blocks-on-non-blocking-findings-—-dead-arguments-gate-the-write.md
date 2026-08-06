---
id: TASK-19
title: >-
  must_fix_before_write blocks on non-blocking findings — dead arguments gate
  the write
status: Done
assignee: []
created_date: '2026-07-31 11:59'
updated_date: '2026-08-01 23:21'
labels:
  - bug
  - mcp-supervisor
  - correctness
  - agent-surface
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Reported by the evaluating agent, reproduced on a clean project with `extends: platformos-check:recommended`:

```
DEAD ARG        | must_fix: true  | error/PartialCallArguments: Unknown parameter bogus passed to render call
                                  | warning/UnrecognizedRenderPartialArguments: Unknown argument 'bogus' ...
MISSING REQ ARG | must_fix: true  | error/MissingRenderPartialArguments + error/PartialCallArguments
CORRECT CALL    | must_fix: false | []
MISSING PARTIAL | must_fix: true  | error/MissingPartial: 'ghost' does not exist
```

Two separate defects:

1. **A dead argument blocks the write.** platformOS ignores an undeclared argument — the page renders correctly. That is dead code, not breakage, and the gate says "you must fix this before writing".
2. **The same defect is reported twice at different severities**: `PartialCallArguments` (ERROR) and `UnrecognizedRenderPartialArguments` (WARNING) both fire on the same unknown argument. They cannot both be calibrated correctly, which is direct evidence that check severities are not a write-gate signal.

## Root cause

`assembleResult` computes `must_fix_before_write: errors.length > 0`, inheriting check-common's severities wholesale. Those severities are calibrated for a LINTER IN AN EDITOR, where ERROR means "red squiggle, look at this". A write gate answers a different question — *will this file be broken if I write it?* — and that is a strictly smaller set. 21 checks carry `Severity.ERROR`; only a handful mean the file will not work.

## Decision

Keep the field, fix its input: an EXPLICIT blocking set owned by the supervisor.

Removing the gate was considered and rejected. It does not remove the judgment, it relocates it: every agent then re-derives its own triage from the diagnostics, inconsistently, and the supervisor stops being a supervisor. It also discards the principle established with `not_applicable` — a field is valuable when it means one honest thing.

```
must_fix_before_write = errors.some(e => BLOCKING.has(e.check))

BLOCKING (the file genuinely will not work):
  LiquidHTMLSyntaxError, JSONSyntaxError, ValidJSON
  MissingPartial, MissingAsset, UnknownFilter
  MissingContentForLayout

NOT blocking (still reported in errors[], agent decides):
  PartialCallArguments, UnrecognizedRenderPartialArguments
  ImgWidthAndHeight, ParserBlockingScript, ... everything else
```

Severity is NOT changed — a dead argument stays an `error` in `errors[]`, it just no longer gates the write. That keeps check-common untouched (the LSP and CLI are unaffected) and keeps the supervisor's agent-ergonomics concern in the supervisor, per the architecture's non-goal #4.

## Design requirements

- The set must be a NAMED, documented constant with a stated rule for membership, not an ad-hoc list — the next person adding a check needs to know which side it belongs on.
- An UNKNOWN check code (a new check, or a community extension) must default to NON-blocking. A gate that blocks on codes it has never heard of would silently regress every time check-common adds a check.
- `validate_files`' batch roll-up must use the same rule, so the two tools cannot disagree.
- The duplicate `PartialCallArguments` / `UnrecognizedRenderPartialArguments` reporting is real but is a check-common concern touching the LSP and CLI; file it separately rather than widening this change.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A dead/unknown argument reports in `errors[]` but yields `must_fix_before_write: false`
- [x] #2 A missing partial, unknown filter and syntax error each still yield `must_fix_before_write: true`. (`MissingAsset` was originally listed here; TASK-19.1 measured it against a live instance — the page renders HTTP 200 and the deploy accepts — so it must NOT block.)
- [x] #3 An unknown/unrecognized check code defaults to NON-blocking, asserted explicitly
- [x] #4 `status` is unchanged by this (still `error` when any error is present) — the gate and the status are separate signals
- [x] #5 The batch form uses the identical rule; a batch blocks only when some file genuinely blocks
- [x] #6 The blocking set is documented with the membership rule, and every entry is justified
- [x] #7 Verified end to end against the real server on the reproduction above
- [x] #8 check-common severities are NOT changed — LSP and CLI behaviour identical
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED AFTER VERIFICATION. The status had been left `To Do` after the work landed; subtask TASK-19.1 was already Done. Re-ran the task's own reproduction through the real server path rather than trusting the code:

```
DEAD ARG          must_fix=false  status=error  errors=[PartialCallArguments]  warnings=[UnrecognizedRenderPartialArguments]
MISSING REQ ARG   must_fix=true   status=error  errors=[MissingRenderPartialArguments,PartialCallArguments]
CORRECT CALL      must_fix=false  status=ok     errors=[]
MISSING PARTIAL   must_fix=true   status=error  errors=[MissingPartial]
UNKNOWN FILTER    must_fix=true   status=error  errors=[UnknownFilter]
SYNTAX ERROR      must_fix=true   status=error  errors=[LiquidHTMLSyntaxError]
MISSING ASSET     must_fix=false  status=error  errors=[MissingAsset]
```

The first row IS the defect this task was filed for, now inverted: the dead argument is still reported at full severity and no longer gates the write. The last row is TASK-19.1's correction holding.

AC#4 is visible in the same table — `status=error` on rows where `must_fix=false`, so the two signals are genuinely separate rather than one derived from the other.

AC#5, batch roll-up on the same rule:

```
all dead args (none genuinely block)   must_fix=false  per-file=[false,false]
one file genuinely blocks              must_fix=true   per-file=[false,true]
```

AC#8 — `PartialCallArguments` still carries `Severity.ERROR` in check-common, so the LSP and CLI are untouched, exactly as the decision required.

THE SET HAS MOVED SINCE THIS TASK PROPOSED IT, and every move was measurement rather than opinion — worth recording here because the task body still shows the original seven names.

Proposed: `LiquidHTMLSyntaxError, JSONSyntaxError, ValidJSON, MissingPartial, MissingAsset, UnknownFilter, MissingContentForLayout`.

- `MissingAsset` removed by TASK-19.1: `asset_url` is string construction, the page returns HTTP 200 and the deploy accepts. AC#2 already carries this correction.
- `ReservedVariableName` removed for the same reason.
- `JSONSyntaxError` and `ValidJSON` removed on REACHABILITY (TASK-29): both are `SourceCodeType.JSON` checks and nothing this server admits is ever parsed as JSON, so they promised coverage the input filter forecloses.
- Added since, each on its own measurement: `JsonLiteralQuoteStyle`, `FilterArity`, `InvalidHashAssignTarget`, `MissingRenderPartialArguments`, `GraphQLCheck`, `GraphQLVariablesCheck`, `YAMLSyntaxError`.

The membership RULE this task asked for (AC#6) survived all of it unchanged and is what made those decisions arguable rather than arbitrary — it now sits at the top of `blocking.ts` in three parts (BLOCKING / EXCEPTION / NOT BLOCKING) with the added instruction that membership is established by measurement, not by reading a check's name.

AC#3 and AC#6 are additionally pinned by tests rather than only by inspection: `blocking.spec.ts` asserts an unrecognised code and a namespaced community-extension code are both non-blocking, and pins the exact membership set so a change to it has to be a deliberate edit. `blocking-emission.spec.ts` (added later, TASK-29) goes further and proves every member can actually fire through the real pipeline — the gap this task's design could not have caught on its own.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verified complete against all eight acceptance criteria and closed; the status had been left open after the work landed, with subtask TASK-19.1 already Done.

`must_fix_before_write` no longer means `errors.length > 0`. It reads an explicit, documented `BLOCKING_CHECKS` set owned by the supervisor, so a dead argument is still reported at full severity in `errors[]` while the gate stays false — the exact defect reported, confirmed inverted by re-running the original reproduction through the real server path. check-common severities are untouched, so the LSP and CLI behave identically.

The design requirements all held: an unknown check code defaults to non-blocking (pinned by test, including a namespaced community-extension code), the batch form uses the identical rule, and `status` remains independent of the gate.

The set itself has moved a long way since this task proposed seven names, and every move was a measurement: `MissingAsset` and `ReservedVariableName` removed because the page renders and the deploy accepts, `JSONSyntaxError` and `ValidJSON` removed because nothing this server admits is ever parsed as JSON, and seven checks added each on its own evidence. The membership RULE this task asked for survived all of it unchanged, which is the part that made those decisions arguable rather than arbitrary.
<!-- SECTION:FINAL_SUMMARY:END -->
