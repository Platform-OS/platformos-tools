---
id: TASK-80
title: >-
  A statement whose markup fails inside a {% liquid %} body is silently
  unreported for some tags
status: To Do
assignee: []
created_date: '2026-08-18 12:02'
updated_date: '2026-08-26 14:51'
labels:
  - check-common
  - liquid-html-parser
  - false-approval
  - measured
dependencies: []
priority: medium
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Measured on the PRE-FIX build, so this predates TASK-66 and is not caused by it.

When a statement's markup rule fails inside a `{% liquid %}` body the tolerant parser stores it as raw markup — the same fallback as a tag — but nothing reports it for every tag.

Reported (block=true, LiquidHTMLSyntaxError): hash_assign h ['k'] = 9; function r ['k'] = 'lib/x'; log: x, type: 'E'; assign = 9; assign x =

SILENT (block=false) though the grammar refuses each and the platform raises: assign ((( = 9; echo ((( ; assign h .k = 9 (which the grammar refuses as of TASK-66)

The pre-fix parser confirms the split is pre-existing: 'assign ((( = 9' and 'echo (((' already produced raw markup and were already unreported.

Consequence: the same construct blocks as a tag and is approved inside a {% liquid %} body, so an author moving working-looking code into a liquid block loses the diagnostic. A FALSE APPROVAL of the same class TASK-66 fixed, one layer further in.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The tag form and the {% liquid %} body form of an identical malformed statement reach the same verdict
- [ ] #2 A statement with raw markup inside a liquid body is reported whichever tag it names
- [ ] #3 assign ((( = 9, echo ((( and assign h .k = 9 inside a liquid body all block, with the tag-form messages unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Re-measured 2026-08-26 against master + TASK-96 (build `01f9acc` + the tolerated-tag-syntax split)

Still reproduces, and the scope is **narrower than filed in one place and misattributed in another**. Swept 20 malformed statements, each in tag form and in `{% liquid %}` body form, through `runBatchLint` (real lint, no mocks).

### Confirmed divergences — 2, both `assign`

| statement | tag form | `{% liquid %}` body |
|---|---|---|
| `assign h .k = 9` | BLOCKS | **silent** |
| `assign x ((( = 9` | BLOCKS | **silent** |

These are the real defect: the identical statement is refused in one spelling and approved in the other, so moving working-looking code into a liquid block loses the diagnostic.

### Correction to the task as filed

`echo (((` is listed above as a liquid-body silence. It is **silent in BOTH forms**, so it is not a tag-vs-liquid divergence at all — it is a uniform missed detection and belongs to a different fix. AC #3 should be split accordingly: the `assign` rows are a consistency bug, the `echo` row is a coverage gap.

### Consistent, and therefore out of scope

16 of the 20 swept statements reach the same verdict in both forms, including every one that already blocks: `assign = 9`, `assign x =`, `echo | upcase`, `hash_assign h ['k'] = 9`, `function r ['k'] = 'lib/x'`, `log: o`, `response_status: 404`, `return (((`, `increment (((`, `render 'a': b: 1`, `include 'a', b`, `cache: k`, `if (((`, `unless (((`.

### TASK-96 did not widen this, verified rather than assumed

The three spellings demoted to `UnconventionalTagSyntax` reach the SAME verdict in both forms — `warning`, non-blocking, in tag form and in a liquid body. Pinned by a parity fixture in `unconventional-tag-syntax/index.spec.ts` so a demoted spelling can never join the divergence list. `log: o` still blocks in both forms, so the demotion did not leak into this path.

### Sweep methodology warning for whoever picks this up

Three false divergences appeared in earlier runs of this sweep, all fixture errors rather than defects:

- a BLOCK tag (`capture`, `case`, `cache`, `if`, `unless`, `for`) written with no closing tag blocks on "never closed", which is a different error than a markup rejection;
- a block body written as a bare token (`X`) inside a `{% liquid %}` body is not a valid statement there, so the error comes from the body and not from the statement under test — use `echo 'X'`;
- the interactive MCP supervisor process does not reload when `dist` is rebuilt, so spot-checks through it report the PREVIOUS build. Import `dist/lint/lint-batch.js` directly, or restart the client.

Each of those produced a plausible, wrong conclusion before being caught.
<!-- SECTION:NOTES:END -->
