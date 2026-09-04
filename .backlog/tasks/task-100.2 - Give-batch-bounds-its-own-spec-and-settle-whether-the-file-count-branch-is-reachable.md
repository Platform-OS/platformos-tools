---
id: TASK-100.2
title: >-
  Give batch-bounds its own spec, and settle whether the file-count branch is
  reachable
status: Done
assignee: []
created_date: '2026-09-03 06:31'
updated_date: '2026-09-03 07:45'
labels:
  - testing
  - platformos-mcp-supervisor
dependencies: []
references:
  - packages/platformos-mcp-supervisor/src/validate/batch-bounds.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.spec.ts
parent_task_id: TASK-100
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`src/validate/batch-bounds.ts` is the weakest file measured — 48% mutation score — and the reason is simple: it has NO spec file. It is reached only incidentally through `validate-code.spec.ts`, which exercises it as a side effect of testing something else. It is a pure function over `BufferToValidate[]`, so a direct spec needs no adapters, no temp project, and runs in milliseconds.

Two distinct problems, both to be settled here.

1. THE BYTE CAP BOUNDARY IS UNTESTED. Changing `bytes > MAX_BATCH_BYTES` to `bytes >= MAX_BATCH_BYTES` survives — no test sends a request of exactly `MAX_BATCH_BYTES` (272,384 bytes / 266 KiB, derived from the deadline ceiling). Note `adapter-input.spec.ts` already pins its own cap exactly ("accepts a buffer exactly at the limit"), so this is an inconsistency with house style rather than a deliberate omission.

2. THE FILE-COUNT BRANCH HAS ZERO COVERAGE, AND MAY BE UNREACHABLE. `if (buffers.length > MAX_BATCH_FILES)` is never executed by any test. This is NOT simply a testing oversight: `VALIDATE_CODE_INPUT.files` in `transport/validate-code.ts` caps the array with `.max(MAX_BATCH_FILES)`, so the MCP protocol boundary refuses an oversized request before the handler runs. Nothing arriving over the wire can reach that branch; only a direct in-process call to `runValidateCode`/`batchTooLarge` can.

That is a decision, not a test: EITHER keep the branch as defence-in-depth for direct callers and cover it with a direct unit test, OR conclude it is dead and say so. Whichever is chosen must be written down in `batch-bounds.ts`, because the next reader will otherwise re-derive it from scratch — or, worse, read the zero coverage as an oversight and "fix" it without noticing the schema already refuses.

Do not paste refusal message text into assertions; this repo derives expected messages from the function under test so a reworded message cannot rot a spec.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/validate/batch-bounds.spec.ts` exists and exercises `batchTooLarge` directly, without going through `runValidateCode`
- [x] #2 The byte cap is asserted at the exact boundary: a request totalling exactly `MAX_BATCH_BYTES` is admitted, and one byte more is refused
- [x] #3 SABOTAGE-VERIFIED: changing `bytes > MAX_BATCH_BYTES` to `>=` fails the new spec; the change is reverted afterwards
- [x] #4 A decision is recorded in a comment in `batch-bounds.ts` about the file-count branch — either that it is defence-in-depth for direct callers (and a direct test covers it), or that it is unreachable through MCP because `VALIDATE_CODE_INPUT.files` caps the array first
- [x] #5 If the branch is kept, a test covers it by calling `batchTooLarge` with more than `MAX_BATCH_FILES` buffers
- [x] #6 Expected refusal reasons are derived from the function under test rather than pasted as literals
- [x] #7 The existing batch tests in `validate-code.spec.ts` still pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce both survivors before writing anything: `bytes > MAX_BATCH_BYTES` -> `>=` (whole package suite still 542/542 green) and a `throw` planted at the top of the file-count branch (never reached, 542/542 green). Neither was inferred.
2. Settle the file-count question by reading the call graph rather than guessing: `runValidateCode` has exactly one non-spec caller (the tool callback), it receives schema-validated args, and it is not re-exported from `src/index.ts` — nor reachable by deep import, since the package `exports` map exposes only `.`. Unreachable over MCP; kept as defence-in-depth.
3. Write `src/validate/batch-bounds.spec.ts` against `batchTooLarge` directly: both caps at their exact boundaries, a multi-byte case, precedence between the two, and that the two refusals do not collapse into one sentence.
4. Record the decision in `batch-bounds.ts` at the branch itself.
5. Sabotage-verify six mutations, then run the whole package suite, type-check, prettier, and a build to confirm the new spec does not ship.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECISION ON THE FILE-COUNT BRANCH: kept, and the reasoning is now in `batch-bounds.ts` at the branch. Unreachable over MCP — `VALIDATE_CODE_INPUT.files` has `.max(MAX_BATCH_FILES)`, the tool callback is `runValidateCode`'s only non-spec caller, and `runValidateCode` is neither re-exported from `src/index.ts` nor deep-importable (the package `exports` map exposes only `.`). Kept anyway because the two bounds live a file apart and only this one is inside the function whose name promises it; a schema loosened for an unrelated reason must not silently un-cap the batch.

SABOTAGE LOG — six mutations, each killed by the intended test and no other:
  bytes `>` -> `>=`            -> only 'ADMITS a request totalling exactly MAX_BATCH_BYTES'
  bytes `>` -> `<`             -> 4 tests (cap fully inverted)
  files `>` -> `>=`            -> only 'ADMITS exactly MAX_BATCH_FILES files'
  `Buffer.byteLength(.,'utf8')` -> `.length` -> only the multi-byte test
  file-count branch deleted    -> 3 tests, incl. 'REFUSES one file more than MAX_BATCH_FILES'
  the two caps' order swapped  -> only 'answers with the FILE-COUNT refusal when a request breaks BOTH caps'

WHY THE PROSE IS NOT PINNED, unlike `adapter-input.spec.ts` which pins `bufferTooLarge`'s message verbatim: there the message is an oracle for a different subject; here `batchTooLarge` IS the subject, so restating its own sentence asserts only that it was copied correctly. What is asserted instead is what a caller acts on. The precedence test derives its expectation by asking the same function about a request that breaks the COUNT cap alone at the same file count, so no sentence is written down.

EVERY FIXTURE CARRIES ITS OWN CONTROL, so no case can be answered by the wrong cap: the file-count tests use one-byte buffers and assert in the same equality that they are under the byte cap; the byte-cap tests assert the measured total alongside the verdict, so 'exactly at the cap' cannot decay into 'comfortably under it'.

Process note for whoever repeats this: `git checkout --` is the wrong way to revert a sabotage while the same file carries uncommitted work — it took the new comment with it twice. Copy the good file aside first.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Gives the supervisor's weakest-measured file (48% mutation score, no spec of its own) a direct spec, and settles the file-count branch question rather than leaving it to the next reader.

**New: `src/validate/batch-bounds.spec.ts`** — seven tests against `batchTooLarge` as a pure function, no adapters and no temp project:
- the byte cap at its exact boundary, both sides: a request totalling exactly `MAX_BATCH_BYTES` is admitted, one byte more is refused (this is the `>` vs `>=` survivor, and it now matches the house style `adapter-input.spec.ts` already sets for `MAX_BUFFER_BYTES`);
- the file-count cap at its exact boundary, both sides;
- bytes rather than string length, via multi-byte content that a `.length` cap would admit;
- precedence — a request breaking both caps answers with the file-count refusal;
- the two caps do not give the same advice, which matters because both carry `code: 'too_large'` and only the prose names the bound that was hit.

**Changed: `src/validate/batch-bounds.ts`** — a comment at the file-count branch, no behavioural change. The branch is unreachable over MCP (`VALIDATE_CODE_INPUT.files` caps the array with `.max(MAX_BATCH_FILES)`, and `runValidateCode` is not on the package's public surface), so its zero coverage is the schema working, not a gap. It is **kept** as defence-in-depth, because only this bound sits inside the function whose name promises it, and the spec now exercises it directly.

**Verification** — six mutations applied by hand and reverted; each was killed by the intended test and no other (log in the implementation notes). Whole package suite 549/549 green (542 before, +7), `type-check` clean, prettier clean, and a build confirms the new spec does not reach `dist`. `validate-code.spec.ts` was not touched.
<!-- SECTION:FINAL_SUMMARY:END -->
