---
id: TASK-8.5
title: >-
  Add a v1-parity safety net for validate_code (compare against captured v1
  baselines, document intentional diffs)
status: To Do
assignee: []
created_date: '2026-06-09 15:57'
labels: []
dependencies:
  - TASK-8.4
references:
  - docs/mcp-supervisor/salvage/OLD-parity-spec.ts
  - docs/mcp-supervisor/salvage/fixtures/parity
parent_task_id: TASK-8
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Prove that the restored `validate_code` matches the v1 contract where that contract is intentionally unchanged. TASK-7.11 captures FRESH baselines only — which cannot demonstrate "functionality intact." This task adds a parity comparison against the 13 captured v1 baselines for the unchanged-contract fields, with deliberate divergences documented in a normaliser rather than silently accepted.

## Why
"Absolute certainty that validate_code functionality remains intact" requires comparing the new output to the old output, not just snapshotting the new output. The salvaged `OLD-parity-spec.ts` + 13 `<NN>-<slug>.expected.json` baselines + `fixtures/parity/corpus.ts` are the reference.

## Scope
- Restore the parity corpus + the 13 v1 baselines into the package test tree.
- Implement a normaliser (port the documented one from `OLD-parity-spec.ts`): sort errors/warnings/infos by `(check, line, column, message)`; strip per-diagnostic analytics/internal fields (`fingerprint`, `template_fp`, `fp`, `params`, any `_`-prefixed); round confidence to 3 decimals.
- Run each corpus entry through the NEW `validate_code` and deep-equal the normalised output against the v1 baseline.
- For every field whose shape legitimately changed in the rebuild (e.g. structured-`data`-driven enrichment, removed analytics fields, any seam-driven hint wording change), extend the normaliser AND document the divergence with rationale — never delete a baseline to make a test pass.
- A divergence registry (in the spec or an adjacent doc) lists each tolerated diff and why.

## Constraints
- The old LSP-message-format contract test is NOT recreated (no string contract exists anymore — TASK-7.11 already excludes it).
- An unexplained drift is a P0 failure: either the rebuild regressed (fix it) or the move is intentional (document it in the normaliser/registry).

## Out of scope
- Capturing fresh baselines for net-new shape (task-7.11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The 13 v1 parity baselines + corpus are restored and each runs through the NEW validate_code
- [ ] #2 A normaliser (ported from OLD-parity-spec.ts) is applied to both sides; unchanged-contract fields deep-equal the v1 baseline
- [ ] #3 Every tolerated divergence from v1 is documented with rationale in a divergence registry; no baseline is deleted to pass
- [ ] #4 An unexplained drift fails the suite (P0); the parity suite runs under root yarn test
<!-- AC:END -->
