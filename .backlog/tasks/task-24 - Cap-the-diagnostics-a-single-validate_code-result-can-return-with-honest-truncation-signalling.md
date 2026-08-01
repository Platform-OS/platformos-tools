---
id: TASK-24
title: >-
  Cap the diagnostics a single validate_code result can return, with honest
  truncation signalling
status: To Do
assignee: []
created_date: '2026-08-01 02:59'
updated_date: '2026-08-01 23:16'
labels:
  - mcp-supervisor
  - agent-surface
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS-ROUND3.md
modified_files:
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/transport/instructions.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There is no bound on how many diagnostics one result carries. A 2 000-offence file returns a **276 KiB** JSON payload with all 2 000 entries. The output is correct, but a single call can consume a large share of an agent's context window — and the supervisor exists to be called before every write, so this is the common path, not an edge case.

Every other unbounded dimension of a request is already bounded: buffer bytes, batch files, batch bytes, lint deadline, impact deadline. The diagnostics list is the one that was missed.

## The constraint that makes this non-trivial

Silent truncation would be a false-completeness bug of exactly the kind this package spends the most effort avoiding. An agent that receives 200 errors and is not told there were 2 000 will fix the 200 and write the file believing it is clean. That is strictly worse than the large payload.

So a cap is only acceptable alongside a signal the agent cannot miss:

- the true total must survive truncation
- `must_fix_before_write` must be computed from ALL diagnostics, before any truncation, so the gate is never softened by dropping the blocking one
- the result must say plainly that it is partial

Note that a file with thousands of offences is nearly always a file with a small number of root causes (an unclosed tag cascading, a missing docset). Ordering is already by line/column, so the head of the list is the most useful part — truncation is genuinely cheap here, provided it is announced.

## Design questions for the implementer

- One cap across all three buckets, or per bucket? Errors matter most; a cap that spends its budget on infos would be poor.
- Where should the total live so it cannot be mistaken for the returned count?
- Should the cap apply per file within a batch, per request, or both? A 50-file batch multiplies whatever is chosen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A file producing thousands of offences returns a bounded payload, with the bound stated as a named constant carrying its rationale
- [ ] #2 `must_fix_before_write` is computed from the complete diagnostic set before truncation — asserted by a case whose only blocking error sorts beyond the cap
- [ ] #3 A truncated result reports the true total for each affected bucket, distinguishable from the number of entries returned
- [ ] #4 A truncated result is self-describing: an agent reading only the JSON can tell that findings were withheld, without consulting the tool description
- [ ] #5 An untruncated result carries no truncation fields at all, so their presence is a reliable signal (consistent with the existing decision to drop permanently-empty stubs)
- [ ] #6 The interaction with batches is decided and tested — whether the cap is per file, per request, or both
- [ ] #7 Diagnostics remain ordered by line then column within each bucket, so the retained head is the top of the file
- [ ] #8 The tool description and server instructions state the cap and what a truncated result means
- [ ] #9 The cap is stated in TOKENS or bytes of serialized payload, not only in diagnostic count — the count is a proxy and the constraint being defended is the agent's context window
- [ ] #10 The batch case is bounded as a REQUEST, not only per file: 4 legal buffers currently multiply to 1.3 MiB, so a per-file cap alone leaves the worst case ~4x the intended bound
- [ ] #11 A pinned measurement of the worst legal single call and the worst legal batch, before and after, so the bound is demonstrated rather than asserted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MEASURED 2026-08-01 against the current build, through the real pipeline. The recorded 276 KiB figure is stale and understates this by more than 2x. Buffer filled with a single repeated offending construct (`{{ 'a' | no_such_filter_xyz }}`), sized to the caps:

| Request | Diagnostics | Payload | ~tokens @ 4 B |
|---|---|---|---|
| 1 file at MAX_BUFFER_BYTES (128 KiB) | 4 228 errors | **634 KiB** | **~162 000** |
| 4 files at MAX_BATCH_BYTES (266 KiB) | 8 784 | **1 313 KiB** | **~336 000** |

So one legal `validate_code` call can return more tokens than most context windows hold, and the supervisor is designed to be called before EVERY write. This is the common path, not an edge case.

The shape of the problem is worth stating plainly: every dimension of the REQUEST is now bounded — buffer bytes, batch files, batch bytes, and since TASK-23 the deadline is derived from the bytes admitted. The RESPONSE is the one unbounded dimension left, and it is ~5x the input it came from. A 266 KiB request producing a 1.3 MiB answer is the inversion that makes this the highest-value remaining item on the agent surface.

IMPLEMENTATION CONSTRAINT, sharpened. The existing note that silent truncation is worse than a large payload is right, and there is now a concrete precedent for how to satisfy it: `blocking-emission.spec.ts` and `cost-model.spec.ts` both assert RELATIONSHIPS rather than values, and the truncation signal should be pinned the same way — `returned <= cap`, `total >= returned`, and `must_fix_before_write` computed from the pre-truncation set. The last of those is the one that must be sabotage-verified: a case whose ONLY blocking error sorts beyond the cap has to still block. That is the single assertion standing between a cap and a false approval.

OPEN QUESTION worth resolving early, because it changes the design: does the MCP stdio transport or a typical client impose its own frame or message limit? A 1.3 MiB JSON-RPC frame may already be failing somewhere before it reaches the model, in which case the current behaviour is not 'large payload' but 'call fails', and the truncation work is a correctness fix rather than an ergonomics one. Not measured.

OPEN QUESTION ABOVE IS NOW RESOLVED — the transport is not the limit, so this stays an AGENT-SURFACE task and not a correctness one. Drove the real stdio bin with the official MCP SDK client (same path as `test/integration/stdio-smoke.spec.ts`), worst legal batch:

```
DELIVERED over stdio
  frame bytes  1,344,856
  diagnostics  8,784
  elapsed      14,610 ms
```

A 1.28 MiB JSON-RPC frame is delivered intact, parses, and carries every diagnostic. Nothing upstream truncates or rejects it. So the payload reaches the model in full, and the damage is entirely context-window consumption rather than a failed call — which is worse in one specific way: there is no error to notice. The agent simply loses most of its working context to one tool result and has no signal that anything unusual happened.

That also removes one design option: a cap cannot be justified as 'the transport would drop it anyway'. It is a deliberate ergonomics judgement about how much of an agent's context one call may spend, and the constant needs to carry that rationale rather than a technical limit.

PROPORTION — CORRECTING THE FRAMING ABOVE, which quoted only the pathological bound and read as though every call were expensive. It is not. Measured against the 21 real files of the eval substrate, plus a realistic broken edit:

| Case | Diagnostics | Response | ~tokens |
|---|---|---|---|
| real project file, median (n=16) | 0 | 0.2 KiB | **~45** |
| real project file, worst | 1 | 0.5 KiB | ~122 |
| realistic broken edit (231 B, 3 errors) | 3 | 0.9 KiB | **~219** |
| 1 file at MAX_BUFFER_BYTES, all-broken | 4 228 | 634 KiB | ~162 000 |
| worst legal batch | 8 784 | 1 313 KiB | ~336 000 |

So a normal call costs **tens to a couple of hundred tokens**, and the alarming figures are three orders of magnitude out on the tail. The pathological buffer is 128 KiB of one repeated broken construct — not a file anyone writes.

The relationship is close to linear at ~153 bytes per diagnostic (~38 tokens), which is the number to size a cap against:

```
   10 diagnostics  ->  ~1.5 KiB   ~380 tokens
  100 diagnostics  ->  ~15 KiB    ~3 800 tokens
 1000 diagnostics  -> ~150 KiB   ~38 000 tokens
```

Token counts are derived at ~4 bytes/token and are ESTIMATES; the byte figures are measured exactly.

CONSEQUENCE FOR PRIORITY — downgraded HIGH to MEDIUM, and the reason is worth recording rather than just the change. This is a TAIL-RISK bound, not a per-call cost: the common path is already cheap, so nothing is gained on it. What the cap buys is protection against a single unusual file — a generated or minified blob, or one cascading syntax error in a large partial — quietly consuming most of an agent's context with no error to notice.

That is still worth fixing, and the implementation constraints above are unchanged. It is not worth fixing ahead of anything that produces a wrong ANSWER, which is how the earlier note's numbers made it read. A cap of a few hundred diagnostics would leave every measured real case untouched.

STILL THE ONE THING THAT MATTERS IN THE IMPLEMENTATION, unchanged by the reproportioning: `must_fix_before_write` must be computed from the COMPLETE diagnostic set, before truncation, and that has to be sabotage-verified with a buffer whose only blocking error sorts beyond the cap. A cap that drops the blocking diagnostic while the gate still reads `false` manufactures precisely the false approval this package exists to prevent — and it would do so only on large inputs, which is where nobody is looking.
<!-- SECTION:NOTES:END -->
