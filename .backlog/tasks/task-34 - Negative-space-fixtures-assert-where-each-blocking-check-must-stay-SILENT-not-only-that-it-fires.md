---
id: TASK-34
title: >-
  Negative-space fixtures: assert where each blocking check must stay SILENT,
  not only that it fires
status: To Do
assignee: []
created_date: '2026-08-02 07:09'
labels:
  - mcp-supervisor
  - check-common
  - false-block
  - testing
  - eval-round4
dependencies:
  - TASK-33
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND4.md
  - /home/ecgtheow/Work/supervisor-tests/eval/METHODOLOGY.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking-silence.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Every guard in this repo asserts that checks FIRE. `blocking-emission.spec.ts` proves each of the eleven blocking codes can be produced. `file-type-coverage.spec.ts` proves each admitted file type produces a diagnostic for a broken buffer. Nothing anywhere asserts that a check stays SILENT on input the platform accepts.

That asymmetry is how TASK-33 happened: a decision measured against the converter, written into a check docstring and into the agent-facing server instructions, was silently reversed by a dependency default while the whole suite stayed green.

It is also the asymmetry that matters most. A missed detection costs one broken file the agent discovers later. A false block is an unappealable refusal: the agent cannot write correct code and has no override. Across four evaluation rounds the false-block count has not moved (6, 6, 6, 6), and every one of those was found by an external evaluator running a live deploy oracle, never by this repo's own suite.

## What this is

The mirror of `blocking-emission.spec.ts`. For each code in `BLOCKING_CHECKS`, a table of inputs that are KNOWN-VALID against the platform, asserted to produce nothing from that check.

The point is not coverage for its own sake. It is that a false block becomes detectable in CI, so the next one does not need an external evaluation and a live instance to find.

## Where the inputs come from

Round 4 already did the expensive part for YAML: 50 of 52 valid-but-unusual shapes were confirmed clean across all four file types, and the two that were not are TASK-33. That corpus should be imported rather than re-derived. `FINDINGS-ROUND4.md` lists the shapes; `METHODOLOGY.md` records which oracle settled each one.

For the Liquid blocking checks, the round-4 `InvalidHashAssignTarget` set is 31 structural cases with zero false blocks, run in both tag spacings. Same treatment.

## Constraint

A fixture is only worth having if its validity was established, not assumed. Round 4 recorded three of its own fixture errors, two of which were "invalid" YAML controls that were actually valid. Each entry must carry the oracle that certifies it, or it is a guess pinned as a fact.<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every code in BLOCKING_CHECKS has at least one pinned VALID input that must produce no diagnostic from that check, with a note recording which oracle established the input is valid
- [ ] #2 The set of covered codes is derived from BLOCKING_CHECKS itself, so adding a blocking code without must-stay-silent coverage fails, the same way blocking-emission.spec.ts derives its EMITS set
- [ ] #3 The YAML corpus is seeded from the 50 valid-but-unusual shapes round 4 proved clean: anchors, aliases, merge keys, all block-scalar forms, explicit and custom tags, BOM, CRLF, multi-document, document-end markers, bare scalars, top-level sequences, deep nesting, very long lines, non-ASCII keys, directives, flow collections
- [ ] #4 Sabotage-verified: reverting the TASK-33 parser option makes this suite fail, proving the corpus can actually detect a false block
- [ ] #5 Each fixture records the oracle that certifies it as valid input, so a future reader can tell a measured fact from an assumption
- [ ] #6 Assertions are whole-value per the repo rule: the full offense array equals the empty array, not a length or membership check
<!-- AC:END -->
