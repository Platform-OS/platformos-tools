---
id: TASK-29
title: >-
  Nothing verified that a BLOCKING_CHECKS member can actually block — a
  registered-but-silent check is a false approval no test could see
status: Done
assignee: []
created_date: '2026-08-01 17:10'
updated_date: '2026-08-01 17:10'
labels:
  - bug
  - mcp-supervisor
  - testing
  - robustness
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND2.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`BLOCKING_CHECKS` is the only place the supervisor makes an independent judgement, and every member is a promise that something gets caught. Two green suites sat on either side of that promise, and neither tested it:

- `blocking.spec.ts` asserts `blocksWrite([{check: 'X'}])` is true. That is a Set lookup — it passes whether or not the check exists.
- each check's own spec asserts the check reports, given a hand-built context. It passes whether or not the supervisor ever routes a file to it.

Nothing in that structure could observe "the check is registered, enabled, defended in a 12-line comment, and emits nothing."

Round 2 of the evaluation found exactly that (N-01, `InvalidHashAssignTarget`), and the failure shape is why it went unnoticed:

- SILENT — "check is dead" and "file is fine" are byte-identical on the wire: `status: ok`, `must_fix_before_write: false`.
- FAILS OPEN — an unrecognised code is deliberately non-blocking, so every failure of this kind resolves to a FALSE APPROVAL. It cannot fail safe.
- SELF-CONCEALING — `blocking.ts` argues each member belongs, so a reader checking their work finds confirmation.
- IT LOOKED LIKE A FIX — the check's known false block vanished at the same time, and nobody investigates a false block going away.

The evaluation could not distinguish "the check is dead" from "my fixture was wrong" for three of the twelve codes, and noted the project had no way to tell it which.

## Direction

One table-driven test over `BLOCKING_CHECKS`: for each member, a real buffer through the real pipeline that must come back blocking. Exhaustive by construction, so a member added without evidence fails at the moment the promise is made.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every member of BLOCKING_CHECKS has a fixture, checked against the set itself so a new member without evidence fails
- [x] #2 Fixtures drive the real pipeline (runValidateCode, real adapters, real project on disk), not check() or the lint adapter — routing and emission fail independently
- [x] #3 Fixtures run under the DEFAULT project config, since 'enabled in the shipped default' is part of what is promised
- [x] #4 Each fixture asserts the exact set of error codes plus the gate outcome, so a fixture that grows an unexpected finding fails
- [x] #5 Members that cannot reach the gate are recorded as a PROOF of unreachability, not skipped
- [x] #6 Sabotage-verified: disabling a check, adding an unevidenced member, and widening the accepted file types each fail the suite
<!-- AC:END -->



## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the missing layer: a table-driven integration suite (`src/result/blocking-emission.spec.ts`, 14 tests) asserting every member of `BLOCKING_CHECKS` can actually block a write, driving real buffers through `runValidateCode` against a real project on disk, under the default config.

RESULT: 10 of 12 members emit and block, offline, in a temp project. The other two are not bad fixtures — they are structurally unreachable, which closes the question the evaluation left open. `ValidJSON` and `JSONSyntaxError` both declare `type: SourceCodeType.JSON`; check-common runs a check only against files of its own type, and `isSupportedSourceFile` admits only `.liquid`, `.graphql` and `.yml`/`.yaml`, which parse as LiquidHtml, GraphQL and YAML. No buffer this server accepts is ever parsed as JSON, so a `.json` buffer is declined `unsupported_type` before any check runs. Both members promise coverage the input filter forecloses — supervisor-owned, not an engine defect.

Recorded as proofs rather than skips, so the exemption keeps earning itself: make `.json` supported, or move either check to another source type, and they fail and demand real fixtures. A separate structural assertion pins the mapping from each accepted extension to its SourceCodeType, so the cause is asserted and not only the symptom.

DELIBERATELY NOT PINNED: `InvalidHashAssignTarget`'s adjacent-tag blindness — an off-by-one in the check's own `findVariableType` (`position <= start`, where a type range starts at the assign tag's `position.end`), so `{% assign x = 5 %}{% hash_assign ... %}` with no separator is invisible while one space or newline fires. Reproduced directly; it is check-common's, out of supervisor scope, and NOT a regression (the check's source is untouched since 20025dd, contrary to the evaluation's diagnosis pointing at PropertyShapeInference). Pinning it would be a test asserting a bug that breaks when the bug is fixed. The fixture separates the tags and asserts only the supervisor's promise: a reported offense reaches the gate and blocks. Nothing here goes red waiting on an engine fix.

Message text and positions are not asserted — they belong to check-common and are pinned by its own specs.

Sabotage-verified three independent ways: disabling a check in the shipped default config, adding an unevidenced member to the set, and making `.json` a supported type. The last needed a rebuild to take effect — cross-package imports resolve to `dist`, so the first attempt was inert and proved nothing.

STILL OPEN, now forced rather than invisible: whether `ValidJSON` / `JSONSyntaxError` stay in `BLOCKING_CHECKS`. Both currently document coverage that does not exist. The proofs pass either way; if the members are removed, the proofs go with them.
<!-- SECTION:FINAL_SUMMARY:END -->
