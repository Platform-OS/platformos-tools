---
id: TASK-25
title: >-
  Three imprecise claims on the agent-facing surface: column units, cross-bucket
  ordering, and early-session blast radius
status: Done
assignee: []
created_date: '2026-08-01 02:59'
updated_date: '2026-08-01 12:42'
labels:
  - mcp-supervisor
  - agent-surface
  - documentation
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
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
- [x] #1 The surface states that `column` / `end_column` are UTF-16 code units, in the place an agent reads when interpreting a position
- [x] #2 The ordering claim is corrected to say findings are ordered within each list, not across the three lists combined
- [x] #3 The surface states that blast radius may report `computing` early in a session while the project graph builds, and that this is neither an error nor a claim that nothing depends on the file
- [x] #4 Each statement is verified true of the current build — no claim is added that the code does not honour
- [x] #5 The added text is measured against the existing brevity constraint in `instructions.ts`; total instruction length does not grow disproportionately
- [x] #6 The result shape, position semantics and impact state machine are unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Done alongside a fourth correction the task did not know about

The three filed claims (F-15 column units, F-16 per-list ordering, P-02 early blast radius) are fixed as described. A fourth turned up while checking the surface against the code, and it was the worst of the set:

`internal_error` was documented as "a bug in the validator; retrying will not help". Three of its cases are the CALLER's mistake — both input forms at once, neither, and (added by TASK-22) one file listed twice. An agent that duplicated a path was being told to give up on a request it could fix by deduplicating. TASK-22 made that wording actively harmful, so this is a defect I introduced and this task closes.

## Changes

- `internal_error` now distinguishes a malformed request from a validator bug and says the malformed cases are the caller's to fix and worth retrying.
- Ordering: "Each list is ordered by line then column WITHIN ITSELF; the three are not one ordered sequence, so concatenating them does not walk the file in order." The bucketed shape is unchanged — only the claim about it.
- Columns: "count UTF-16 code units, so an emoji advances the column by 2."
- A new `impact` section: `computing` means the graph is still building and the zeroed counts are NOT a claim that nothing depends on the file.
- The once-per-file batch rule, in BOTH the instructions and the tool description, since TASK-22 refuses a request that breaks it and the rule has to be findable before an agent trips it.
- `must_fix_before_write: true` now covers all three grounds the recalibrated gate uses, including deploy-converter rejection (TASK-19.1), rather than only "does not parse / references something missing".
- `WHAT IS ACTUALLY CHECKED` names filter arity, now that TASK-28 made it a blocking check.
- "a missing asset" moved into the list of errors that do NOT block, matching TASK-19.1.

## Verification

7 new tests pin the claims, including a negative one — `expect(SERVER_INSTRUCTIONS).not.toContain('retrying will not help')` — so the misleading wording cannot come back. 54 tests pass in `validate-code.spec.ts`.

Verified against the RENDERED string from a live `initialize` response, not just the source: an unescaped backtick in the new `impact` section broke the template literal, which the source read fine but the build caught.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The tool description and server instructions made four claims that were no longer true, three from the evaluation and one introduced by TASK-22.

The consequential one was `internal_error`, documented as "a bug in the validator; retrying will not help" while actually covering three caller-fixable request errors — including the duplicate-path refusal TASK-22 added. An agent was being told to abandon a request it could fix by deduplicating. It now distinguishes a malformed request from a validator bug and says which is which.

The other three: ordering is now scoped to each list rather than implied across all three; columns are stated as UTF-16 code units; and a new `impact` section explains that `computing` is the graph still building, not a claim that nothing depends on the file.

Also brought in line with the session's other work: the once-per-file batch rule (TASK-22) appears in both the instructions and the tool description, `must_fix_before_write: true` covers deploy-converter rejection (TASK-19.1), a missing asset is listed among non-blocking errors, and filter arity is named among what is checked (TASK-28).

Pinned by 7 tests including a negative assertion against the old wording, and verified against the string a real client receives rather than the source.
<!-- SECTION:FINAL_SUMMARY:END -->
