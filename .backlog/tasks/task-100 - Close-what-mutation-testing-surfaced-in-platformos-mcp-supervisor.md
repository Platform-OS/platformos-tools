---
id: TASK-100
title: Close what mutation testing surfaced in platformos-mcp-supervisor
status: Done
assignee: []
created_date: '2026-09-03 06:30'
updated_date: '2026-09-03 07:48'
labels:
  - testing
  - platformos-mcp-supervisor
  - mutation-testing
dependencies: []
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A local Stryker 10 run over 11 of the supervisor's 29 source files (551 mutants, 82.4% score) found guards that can be deleted with the whole suite still green, plus two design facts that are correct in behaviour but recorded nowhere.

WHY THIS MATTERS: none of these is a bug today. Each is a promise the suite does not keep — a defence that could be removed or inverted in a future refactor without a single test noticing — or a fact the next reader will have to re-derive from scratch.

CONTEXT A FUTURE IMPLEMENTER NEEDS: Stryker is NOT part of this repository. It was installed locally and its configs (`packages/*/stryker.config.mjs`, `packages/*/vitest.stryker.config.mjs`) are gitignored, so you cannot reproduce these findings by running a project script. You do not need to. Every item below states the exact one-line change that survives today, and CLAUDE.md already requires the same discipline: apply the change by hand, confirm the new test fails, then revert. That is the verification, and it is enough.

If you do want the tool back:
  yarn add -W -D @stryker-mutator/core@^10 @stryker-mutator/vitest-runner@^10
  git checkout -- package.json yarn.lock

READ THE REPORT WITH THIS CAVEAT. The mutation run excludes `test/integration/**` and `test/guards/**`, because those specs cannot run inside Stryker's sandbox — `stdio-smoke.spec.ts` shells out to `yarn build`, and the guards scan the repository's own layout. Code covered ONLY by those specs therefore shows as uncovered when it is nothing of the sort. That already produced one false finding: the `validate_code` tool-callback body (`transport/validate-code.ts`, the `content: [{ type: 'text', … }]` envelope) reported four no-coverage mutants, and `test/integration/stdio-smoke.spec.ts` in fact calls the tool over a real stdio transport and asserts that exact envelope. No work is needed there. Check the integration specs before believing any no-coverage result.

Deliberately OUT of scope, reviewed and set aside: `assemble.ts` empty-list assertions; the malformed-request sub-branches at `validate-code.ts:289/290/313`; and roughly 50 string-literal mutants that survive because tests derive expected messages from the code under test rather than pasting them, which is this repository's deliberate anti-rot choice and should stay that way. At least one of those is provably unkillable — `Buffer.byteLength(s, '')` equals `Buffer.byteLength(s, 'utf8')`, measured.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All three subtasks Done. Files changed, all in `packages/platformos-mcp-supervisor`:
  M src/result/response-budget.spec.ts   (+1 test, +`bytesOf` helper that `diagnosticBytes` now reuses)
  A src/validate/batch-bounds.spec.ts    (new, 7 tests)
  M src/validate/batch-bounds.ts         (comment only, +13 lines, 0 removed)
  M src/validate/validate-buffers.ts     (comment only, +18 lines, 0 removed)
No production behaviour changed. `validate-code.spec.ts` was not touched.

The branch also carries two pre-existing uncommitted hygiene changes that are NOT part of this task: `.gitignore` (Stryker artefacts) and `vitest.config.mjs` (excluding `.stryker-tmp` so a leftover sandbox cannot be collected as a second copy of every spec running against mutated code).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All three subtasks closed. Two new tests' worth of promises the suite was not keeping, one branch decision settled, and one guard documented — no production behaviour changed anywhere.

**100.1 — the warnings truncation is now pinned.** `response-budget.ts` could return the `warnings` bucket unsliced with the entire suite green. One test in `response-budget.spec.ts` drives 40 warnings against a budget derived from the fixture to pay for exactly 12, and asserts the whole returned result in one equality. The errors and infos slices turned out to be pinned already, by the contiguity test and the severity-order test respectively — confirmed by sabotaging all three, not assumed.

**100.2 — `batch-bounds.ts` has a spec, and the file-count branch has an answer.** New `batch-bounds.spec.ts`, seven tests against `batchTooLarge` directly: both caps at their exact boundaries in both directions, bytes-not-characters, precedence between the two caps, and that the two refusals do not collapse into one message. The file-count branch is unreachable over MCP (`VALIDATE_CODE_INPUT.files` caps the array first, and `runValidateCode` is not on the package's public surface) and is **kept** as defence-in-depth, with that reasoning now written at the branch itself so its zero coverage is not read as a gap.

**100.3 — `worthReading` is documented as a performance guard.** Its six survivors are explained by `warm()` only pre-warming a promise impact awaits itself; inverting it cannot change a verdict.

**Verification.** Every claim was measured rather than carried over from the report: both survivors reproduced before any test was written, the file-count branch proved unreachable by planting a `throw` in it, and ten hand-applied mutations across the three files each killed by the intended test and no other. Package suite 549/549 (542 before), type-check clean, prettier clean, build confirms the new spec does not ship in `dist`.

**One correction to the report itself**, recorded in 100.3's notes: the neighbouring `--no-impact` "costs NOTHING" claim was described as wholly untested. It is untested in half — the impact adapter never being called IS asserted in `validate-code.spec.ts`; the project read being skipped is not. The comment states that split rather than the flattened version.

**Out of scope and untouched, as the task specified:** `assemble.ts` empty-list assertions, the malformed-request sub-branches, and the ~50 string-literal mutants that survive because tests derive expected messages from the code under test.
<!-- SECTION:FINAL_SUMMARY:END -->
