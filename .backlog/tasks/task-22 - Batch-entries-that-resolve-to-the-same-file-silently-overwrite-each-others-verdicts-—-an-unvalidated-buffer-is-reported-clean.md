---
id: TASK-22
title: >-
  Batch entries that resolve to the same file silently overwrite each other's
  verdicts — an unvalidated buffer is reported clean
status: Done
assignee: []
created_date: '2026-08-01 02:58'
updated_date: '2026-08-01 03:44'
labels:
  - bug
  - mcp-supervisor
  - correctness
  - agent-surface
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/lint/lint-batch.ts
  - packages/platformos-mcp-supervisor/src/validate/validate-buffers.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

When two entries in one `validate_code` batch resolve to the same absolute file, the last buffer wins the lint and **its verdict is reported for both entries**. The first buffer's content is never validated, and the response gives no indication of it.

```
files: [ { "app/views/partials/x.liquid", "{{ 'x' | no_such_filter }}" },   <- broken
         { "app/views/partials/x.liquid", "<p>clean</p>" } ]                <- clean

-> must_fix_before_write: FALSE
   files[0].result.status = "ok"    <- the BROKEN buffer, reported clean
   files[1].result.status = "ok"
```

Reversing the order makes both report `error`, so the direction of the lie depends on argument order.

This is the only defect in the evaluation that turns a clean report into a **false approval by construction**, independent of any check calibration. It cannot be recovered by fixing the blocking set, and it produces exactly the outcome the whole `not_applicable` design exists to prevent: a file reported as validated when nothing examined it.

## Root cause

Two different key spaces are used for the same buffers:

- `runBatchLint` (`lint/lint-batch.ts`) builds `absoluteByKey` keyed by the caller's raw `filePath` STRING, then re-keys results by normalising each entry to a URI.
- `lintBuffers` (check-node) overlays and deduplicates by normalised URI, last entry winning.

So N distinct caller strings that normalise to ONE uri all read back that single uri's offenses — which belong to whichever buffer `lintBuffers` kept. `validateBuffers` then builds its result map from `buffers.map(b => [b.filePath, ...])`, which additionally collapses byte-identical duplicate strings.

Three spellings reproduce it, all plausible from an agent assembling a changeset:

- the same relative path twice
- absolute + relative spelling of one file
- `partials/x.liquid` + `partials/./x.liquid`

## Direction

Two defensible fixes; pick one deliberately rather than patching the symptom.

1. **Reject the request.** A batch whose entries resolve to the same absolute path is incoherent — a changeset cannot contain two versions of one file. Decline the whole request with a reason naming the colliding entries. Consistent with how `batchTooLarge` already refuses rather than silently validating a subset.
2. **Key by normalised URI and return the mapping**, so the caller can see that two of its entries were one file and which content was checked.

Option 1 is the smaller change and matches existing refusal precedent; option 2 preserves more caller ergonomics. What is NOT acceptable is any outcome where a buffer that was never linted is reported with a status.

Note that the current caller-string keying is deliberate and documented (a caller mixing relative and absolute paths must find its own results without reproducing our normalisation). Preserve that property for the non-colliding case.

## Evidence

`eval/results/followup.json`, group `X-dup-keys`. Batch semantics otherwise scored 7/9 — these two failures are the only ones.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two batch entries with the identical relative path and different content never produce a result in which a buffer that was not linted carries a `status` — verified in both argument orders
- [x] #2 The absolute + relative spelling of one file, and the `x.liquid` + `./x.liquid` spelling, are handled identically to the exact-duplicate case
- [x] #3 A batch of distinct files still returns results keyed so that a caller mixing relative and absolute paths finds each of its own entries, unchanged from today
- [x] #4 If the chosen direction is refusal, the whole request is declined with a reason naming the colliding entries, and nothing is reported as checked
- [ ] #5 If the chosen direction is URI keying, the response makes the collapse visible to the caller — which entries were one file, and whose content was validated
- [x] #6 `must_fix_before_write` for the batch can never be `false` on the strength of a buffer that was not linted
- [x] #7 A regression test covers all three colliding spellings, asserting whole result values rather than a status field alone
- [x] #8 Verified end to end against the real server, not only in unit tests
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Direction chosen: REFUSE the request (option 1)

A changeset cannot contain two versions of one file, so there is no correct winner to pick. Refusing follows the existing `batchTooLarge` precedent — the incoherence is a property of the REQUEST, so validating a subset would report a changeset as checked when it was not.

Option 2 (URI keying + returning the mapping) was rejected: it preserves the ability to send an incoherent request and then requires the agent to interpret a collapse it did not intend. The current caller-string keying is deliberate (a caller mixing relative and absolute spellings must find its own entries without reproducing our normalization) and is fully preserved for every non-colliding request.

## Where it lives

New module `validate/batch-coherence.ts`, deliberately NOT folded into `batch-bounds.ts`. Different question and different input: a cap is a pure function of buffer content, while deciding whether two entries name the same file needs the project root to resolve relative paths against.

Collision is decided on the SAME normalized URI the overlay deduplicates on (`pathUtils.normalize(URI.file(toAbsoluteFilePath(...)))`), so the guard cannot disagree with the mechanism it protects.

Wired in `runValidateCode` next to `batchTooLarge` as a `??` chain — first refusal wins, cheaper content-only check first. Refusal `code` is `internal_error`, matching the sibling malformed-request refusal in `requestedBuffers`.

## Identical content is refused too

Safe to merge in principle, but "same path twice" is a caller bug either way, and a content-equality carve-out is one more branch that can be wrong.

## Verification

18 new tests (13 unit + 5 handler-level). Sabotage-checked: removing the guard fails exactly the 4 new handler tests, confirming they bite rather than passing vacuously.

End to end against the real stdio server on a live project — all three colliding spellings decline every entry with `not_applicable` / `internal_error` and `must_fix_before_write: false`; nothing is reported as checked. A batch naming each file once, with mixed absolute/relative spelling, still returns `ok, ok` and cross-buffer partial resolution still works.

Full monorepo suite: 2918 passed, 1 pre-existing unrelated failure (the known `fileFingerprint` full-suite flake, TASK-14).

## AC#5 not applicable

It was conditional on choosing the URI-keying direction, which was not chosen.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two entries in one `validate_code` batch that resolved to the same absolute file used to lint ONE buffer (last wins, by normalized URI) while reporting that verdict for BOTH entries — so a buffer that was never validated came back with a status, and reversing the argument order flipped which one was lied about. It was the only defect in the evaluation that manufactured a false approval with no check involved at all, and therefore the only one no amount of gate calibration could recover.

Fixed by refusing the request. A new `validate/batch-coherence.ts` groups the caller's path spellings by the same normalized URI the overlay deduplicates on; if any file is named more than once, the whole request is declined with a reason naming the colliding entries, before any buffer is linted. This follows the existing `batchTooLarge` precedent rather than inventing a second refusal style.

The caller-string result keying that made the bug possible is deliberate and is preserved unchanged for every coherent request, including the mixed absolute/relative spelling it exists to support.

18 new tests, sabotage-verified. Confirmed end to end against the real server: all three colliding spellings (same path twice, absolute + relative, `x.liquid` + `./x.liquid`) decline every entry; a batch naming each file once still validates and still resolves partials across buffers.
<!-- SECTION:FINAL_SUMMARY:END -->
