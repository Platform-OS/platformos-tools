---
id: TASK-25
title: >-
  Three imprecise claims on the agent-facing surface: column units, cross-bucket
  ordering, and early-session blast radius
status: To Do
assignee: []
created_date: '2026-08-01 02:59'
labels:
  - mcp-supervisor
  - agent-surface
  - documentation
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The tool description and server instructions ARE the agent's entire understanding of this tool, and `instructions.ts` already states the rule that governs this task: a claim that overstates what the server does "converts 'I do not know' into false confidence". Three claims currently fail that standard. None is a code defect; all three are things an agent can act on wrongly.

**1. Column units are unspecified (F-15).** Columns are UTF-16 code units — verified: `e` with an acute accent counts 1, an emoji counts 2. That is correct LSP behaviour, but it is stated nowhere and is not inferable. An agent counting code points misplaces every column after an emoji. Positions are otherwise exact, including CRLF and astral-plane characters, so this is purely a units question.

**2. The ordering claim holds per array, not across the file (F-16).** `instructions.ts` says "Every finding, ordered by line then column". `assemble.ts` sorts the full list and THEN partitions into `errors` / `warnings` / `infos`, so each array is ordered but concatenating them is not file order:

```
errors:   ImgWidthAndHeight@1:1  UnknownFilter@2:8  ParserBlockingScript@4:1  MissingPartial@5:11
warnings: UnusedAssign@3:1
```

The bucketed shape is deliberate and should stay; the sentence describing it should say "within each list".

**3. Blast radius is unavailable for the first seconds of a session (P-02).** `impact.status` stays `computing` until the background graph build finishes — 1.9 s on 33 files, 3.8 s on 533, 5.5 s on 1 533. The behaviour is correct and deliberate (the design prefers `computing` to a stale answer, and zeroes `dependents` rather than reporting something wrong), but it is undocumented. On a large project that window covers a realistic burst of early edits, and an agent has no way to know its first few validations carry no blast radius. Note `IMPACT_DEADLINE_MS` is never the binding constraint here — the graph build is.

## Scope

Description and instruction text only. Do not change the bucketed result shape, the position semantics, or the impact state machine — all three are correct as built. The evaluation scored the surrounding areas cleanly (positions exact on 51/51 diagnostics; blast radius 7/7, its strongest component), so this is about describing existing behaviour accurately, not changing it.

Keep the text short. `instructions.ts` documents its own constraint: this is spent context on every session, competing with the user's actual task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The surface states that `column` / `end_column` are UTF-16 code units, in the place an agent reads when interpreting a position
- [ ] #2 The ordering claim is corrected to say findings are ordered within each list, not across the three lists combined
- [ ] #3 The surface states that blast radius may report `computing` early in a session while the project graph builds, and that this is neither an error nor a claim that nothing depends on the file
- [ ] #4 Each statement is verified true of the current build — no claim is added that the code does not honour
- [ ] #5 The added text is measured against the existing brevity constraint in `instructions.ts`; total instruction length does not grow disproportionately
- [ ] #6 The result shape, position semantics and impact state machine are unchanged
<!-- AC:END -->
