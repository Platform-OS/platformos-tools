---
id: TASK-19
title: >-
  must_fix_before_write blocks on non-blocking findings — dead arguments gate
  the write
status: To Do
assignee: []
created_date: '2026-07-31 11:59'
updated_date: '2026-08-01 03:43'
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
- [ ] #1 A dead/unknown argument reports in `errors[]` but yields `must_fix_before_write: false`
- [ ] #2 A missing partial, unknown filter and syntax error each still yield `must_fix_before_write: true`. (`MissingAsset` was originally listed here; TASK-19.1 measured it against a live instance — the page renders HTTP 200 and the deploy accepts — so it must NOT block.)
- [ ] #3 An unknown/unrecognized check code defaults to NON-blocking, asserted explicitly
- [ ] #4 `status` is unchanged by this (still `error` when any error is present) — the gate and the status are separate signals
- [ ] #5 The batch form uses the identical rule; a batch blocks only when some file genuinely blocks
- [ ] #6 The blocking set is documented with the membership rule, and every entry is justified
- [ ] #7 Verified end to end against the real server on the reproduction above
- [ ] #8 check-common severities are NOT changed — LSP and CLI behaviour identical
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
