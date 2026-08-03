---
id: TASK-52
title: Two SERVER_INSTRUCTIONS sentences are true as written and misleading as read
status: Done
assignee: []
created_date: '2026-08-03 11:15'
updated_date: '2026-08-03 17:10'
labels:
  - mcp-supervisor
  - agent-surface
  - eval-final
dependencies:
  - TASK-47
  - TASK-51
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-FINAL.md
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
modified_files:
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - packages/platformos-mcp-supervisor/src/result/blocking-emission.spec.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`SERVER_INSTRUCTIONS` is spent context in every session and is the agent's entire model of the tool. A sentence that overstates coverage converts "I do not know" into false confidence — which is the failure mode this whole server exists to prevent. Both sentences below pass a literal reading and mislead in practice.

## (a) The filter sentence draws the boundary in the wrong place

> "A filter in a tag OPERAND is fine and is NOT reported — cache, log, yield, redirect_to, response_headers, spam_protection, render's with/for, case, when and cycle each take one."

Literally true and verified: `{% log 'm' | upcase %}` is allowed. But it names ten tags and tells an agent filters are fine **in them**, and the very next thing an agent writes — `{% log 'm', type: 't' | upcase %}` — is a false block on a buffer the converter accepts (TASK-47).

The boundary is the **position within** the tag, not the tag. The sentence I wrote invites exactly the wrong generalisation.

**Depends on TASK-47.** Once the argument-value positions accept filters, this sentence becomes accurate as read and may need only a small widening rather than a rewrite. Do not rewrite it before that lands, or it will describe a state the code is about to leave.

## (b) The duplicate-key sentence is stated without qualification

> "A key defined TWICE in the same mapping is reported as a warning and does NOT block."

False for 11 of the 61 tokens in the project's own Psych corpus. `en:\n  .inf: 1\n  .inf: 2` — literally the same text twice, one key on the platform, last value wins — produces **no warning at all** (TASK-51).

**Depends on TASK-51.** If that task closes the diagonal gap the sentence becomes true and needs no change; if a measured gap remains, the sentence must say so, because an instruction that overstates what IS reported turns a silence the agent receives into something it was told could not happen.

## What is NOT wrong — seven claims verified

The eval checked nine instructions claims. These seven pass, and the two that fail are above:

- the text is returned on `initialize` (5704 chars)
- columns count UTF-16 code units — verified precisely, paired: `{{ '👋' }}` and `{{ 'ab' }}` both put the next diagnostic at column 16, `{{ 'a' }}` at 15
- `errors[]` can be non-empty while `must_fix_before_write` is false
- `ignored` returns `not_applicable`
- GraphQL operations are validated against the project schema
- the YAML 1.1 collision examples (`yes:`/`true:`, `014:`/`12:`, `null:`/`~:`) — all three correct
- coverage is per project

## Constraints

Claims here are pinned by `validate-code.spec.ts` precisely so they cannot rot. Any sentence change updates its assertion in the same edit, and the assertion must pin the *substance* rather than the wording. The supervisor stays a thin layer: no behaviour change belongs in this task.

Keep it short. This text competes with the user's actual task for context.

## Falsifier

An agent reading the corrected text and still generalising to a position the converter rejects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The filter sentence states the rule by POSITION, so an agent cannot generalise from operand to argument value — reconciled with whatever TASK-47 actually shipped
- [x] #2 The duplicate-key sentence is either true without qualification, or names the remaining gap — reconciled with whatever TASK-51 actually shipped
- [x] #3 Both sentences are pinned in validate-code.spec.ts by substance, not by exact wording, in the same change
- [x] #4 The instructions do not grow materially — this is spent context on every session
- [x] #5 The seven claims that currently pass still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#1 was already satisfied by TASK-47

The task said not to rewrite the filter sentence before TASK-47 landed, or it would describe a state the code was about to leave. TASK-47 reconciled it on the way through: the text now states the rule by POSITION with all three fates — REJECTED in a condition, IGNORED elsewhere in a tag, APPLIED where the whole value is a Liquid variable. Verified, no change needed here.

## AC#2 split into a satisfied half and a real one

**Satisfied.** "A key defined TWICE in the same mapping is reported as a warning and does NOT block" is now true WITHOUT qualification. Verified end to end through the supervisor, not just through `findDuplicateKeys`: all 11 previously-missed identical spellings (`y`, `Y`, `n`, `N`, `0X10`, `1e3`, `.inf`, `-.inf`, `.nan`, `1:30`, `2026-01-01`) now produce a `DuplicateYAMLKey` warning and do not block. TASK-51 made that true.

**Not satisfied, and fixed.** The FOLLOW-ON sentence — "Two keys that merely LOOK different can still be ONE key … yes:/true:, 014:/12: and null:/~: each collide" — sits under the heading **WHAT IS ACTUALLY CHECKED**. Naming three collisions there without bounding the rest reads as a coverage claim, and it is false for four MEASURED shapes: `1:30`/`5400`, and the quoted-versus-plain forms of `0X10`, `1e3` and `y`. An agent treating silence there as proof the keys are distinct would have been misled by us.

One clause added, carrying both the strong guarantee and the bound:

> A repeat of the SAME spelling is always reported; look-alike detection is not exhaustive, so silence there does not prove two keys are distinct.

## AC#3 — pinned in BOTH places, because prose and behaviour rot separately

Prose in `validate-code.spec.ts`. BEHAVIOUR in `blocking-emission.spec.ts` against the real pipeline: one test that the 7 representative previously-missed tokens warn without blocking, and one CONTROL that the 4 undecidable pairs stay silent. Asserting only the first would let the qualifier be deleted as redundant; asserting only the second would let the prose drift.

Sabotage: deleting the qualifier from the instructions fails the prose pin; reverting TASK-51's raw identity fails the behaviour pin. Both confirmed, restored 92/92.

## A fragile pin of my own, found and fixed

TASK-47 left this in `validate-code.spec.ts`:

```ts
ignored: SERVER_INSTRUCTIONS.includes('the platform\n            IGNORES it'),
```

That encodes the LINE WRAPPING. A pure reflow — changing nothing about the claim — would have failed it, and a test that fails for the wrong reason trains people to edit the test rather than the code. All four instruction pins now collapse whitespace first, so they assert the sentence and not its layout.

## AC#4 — compressed rather than accepting the growth

The text had reached 6492 chars. Both edited paragraphs were tightened to **6254 chars (~1564 tokens)**, so the net cost of everything added since the eval measured 5704 is **+550 chars** for three substantive additions: the `hash_assign` bracket rule (TASK-49), the three-fates filter rule (TASK-47), and this duplicate-key bound. Each prevents a specific, measured class of agent error, which is the only reason any of them earn their place in text that is spent on every session.

What was cut was mechanism, not instruction: the tag-scanner explanation behind the ignored filter, and one of two redundant examples. An agent needs to know what to do, not why the platform does it.

## AC#5 and a staleness pass

The seven eval-verified claims still pass. Beyond the ACs, I re-read the whole text for staleness after five landed tasks, since it had not been reviewed as a whole since round 5: nothing else is out of date. `must_fix_before_write: true` already covers TASK-49's parse error under "It will not parse", and the warnings section enumerates no check names, so `FilterWithoutEffect` needed no mention.

## Verification

- Supervisor package **22 files / 390 tests**; check-common + parser + LSP **162 files / 2076 tests**; `yarn build` clean; `format:check` clean.
- Only supervisor files changed, so that package is the authoritative suite for this task; the dependent packages were run to confirm no coupling.
- Two sabotages, both bite, each failing the half it targets.
<!-- SECTION:NOTES:END -->
