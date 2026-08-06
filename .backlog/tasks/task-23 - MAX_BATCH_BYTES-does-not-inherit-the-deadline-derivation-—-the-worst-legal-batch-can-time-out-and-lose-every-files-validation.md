---
id: TASK-23
title: >-
  MAX_BATCH_BYTES does not inherit the deadline derivation — the worst legal
  batch can time out and lose every file's validation
status: Done
assignee: []
created_date: '2026-08-01 02:59'
updated_date: '2026-08-01 17:09'
labels:
  - bug
  - mcp-supervisor
  - robustness
dependencies: []
references:
  - /home/ecgtheow/Work/supervisor-tests/eval/FINDINGS.md
modified_files:
  - packages/platformos-mcp-supervisor/src/cost-model.ts
  - packages/platformos-mcp-supervisor/src/cost-model.spec.ts
  - packages/platformos-mcp-supervisor/src/context.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.spec.ts
  - packages/platformos-mcp-supervisor/src/validate/batch-bounds.ts
  - packages/platformos-mcp-supervisor/src/validate/validate-buffers.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`MAX_BUFFER_BYTES` (128 KiB) was carefully derived FROM `LINT_DEADLINE_MS`: the worst single buffer measures ~10 s idle and ~23 s under load, and 60 s was chosen to give ~2.6x headroom over the loaded figure. That derivation is documented at length in `context.ts`.

`MAX_BATCH_BYTES` did not inherit it. It is set as a round `4 * MAX_BUFFER_BYTES` = 512 KiB, justified only as "four worst-case single buffers, so a batch can never cost more than a handful of legal single calls". But the deadline is per-REQUEST, not per-call, so four worst buffers in one request consume 4x the work against the same 60 s budget.

Measured at the bound:

```
4 files x 127 KiB = 508 KiB  ->  27 943 ms   (all 4 checked, gate correct)
LINT_DEADLINE_MS = 60 000 ms ->  2.1x headroom, on an IDLE box
```

Applying the same 2-3x load factor that motivated the 60 s deadline puts the worst legal batch at roughly 56-84 s — at or past the deadline.

## Why this matters more than a slow call

The failure mode is total, not degraded. A lint timeout yields `not_applicable` / `timed_out` for **every** file in the request, so a large-but-legal changeset receives no validation at all — silently, and precisely when it is the most expensive to get wrong. `context.ts` already argues this exact point for the single-buffer case: "a deadline that fires on a legitimately slow call is WORSE than none".

## Direction

Either is acceptable; the point is that the batch bound must be derived rather than chosen as a round multiple.

1. Derive `MAX_BATCH_BYTES` from `LINT_DEADLINE_MS` and the measured ms/KiB the way `MAX_BUFFER_BYTES` is, preserving comparable headroom under load.
2. Scale the deadline for multi-buffer requests, so the budget grows with the work admitted.

Whichever is chosen, the constant must carry the derivation in its comment, so the next person changing either value sees that the two are coupled.

## Supporting measurement

Independent benchmarking in the same evaluation confirms the documented cost model is accurate — 57 ms/KiB above 16 KiB against a claimed 61, and 7.3 s at the 127 KiB bound against a claimed 7.1 s — so `MAX_BUFFER_BYTES` itself is calibrated correctly and should not move. Note also that cost is driven by parse work rather than size alone (127 KiB of a repeated single character validates in 2.5 s), so any derivation should be stated against representative markup, as the existing one is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `MAX_BATCH_BYTES` (or the multi-buffer deadline) is derived from `LINT_DEADLINE_MS` and the measured cost model, not set as a round multiple
- [x] #2 The worst legal batch is measured under load, not only idle, and retains headroom comparable to the ~2.6x the single-buffer bound was given
- [x] #3 The constant's comment states the derivation and names the coupling to `LINT_DEADLINE_MS`, so changing one surfaces the other
- [x] #4 A request at the new bound completes within the deadline under load, verified by measurement rather than calculation
- [x] #5 A request that exceeds the bound is still refused whole, with nothing reported as checked — the existing refusal semantics are preserved
- [x] #6 The existing per-buffer `MAX_BUFFER_BYTES` bound is unchanged, since independent benchmarking confirms it is correctly calibrated
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Direction 1 and 2 from the task are BOTH required, and that is the finding rather than a choice.

Deriving `MAX_BATCH_BYTES` from a FIXED 60 s deadline yields ~133 KiB — smaller than `MAX_BUFFER_BYTES` (128 KiB), so a one-file batch containing a file the single-file form accepts would be refused for the shape of the request. A fixed deadline and a meaningful batch cap cannot coexist. So the deadline scales with admitted bytes, and the cap is derived from the ceiling on that deadline.

New module `src/cost-model.ts` holds the whole relationship as arithmetic, from named measured factors:

  LINT_MS_PER_KIB      75    slowest observed rate (508 KiB batch at 37.8 s, post-FilterArity)
  LOAD_FACTOR          3     measured ~2.3-3.5x; held at the pessimistic end
  DEADLINE_MARGIN      2     the margin the old 60 s already carried over one worst buffer
  DEADLINE_MS_PER_KIB  450   the product
  MIN_LINT_DEADLINE_MS 60_000   floor, covers the fixed per-call cost (config, app, graph)
  MAX_LINT_DEADLINE_MS 120_000  the one POLICY number: how long the server will ever wait

  lintDeadlineMs(bytes) = max(MIN, ceil(bytes/1024) * 450)
  MAX_BATCH_BYTES       = maxBytesWithin(MAX_LINT_DEADLINE_MS) = 272_384 B = 266 KiB

`lintDeadlineMs(MAX_BUFFER_BYTES)` is exactly 60 s, so every single-file call — which is every call in practice — behaves precisely as before. `MAX_BUFFER_BYTES` itself is untouched (AC#6): it answers a different question (when the parser becomes the problem for one file) and is now CHECKED against the model rather than merely coexisting with it.

The deadline is sized on the bytes ACTUALLY ADMITTED (post-partition, after declined buffers are dropped), computed once in `validateBuffers` and threaded to both the timer and the timeout message, so the two cannot disagree about the deadline a caller was held to.

MEASUREMENT (AC#2, AC#4). The derived cap was run through the real `runValidateCode` against a live 21-file platformOS project, using the project's own markup repeated to size — not a repeated character, which validates ~3x faster and would have flattered the result. Idle first, then with every core but one saturated.

| shape at the 266 KiB cap | idle | loaded | load factor | headroom vs its deadline |
|---|---|---|---|---|
| 4 x 66.5 KiB | 4.1 s | 11.0 s | 2.67x | 10.9x |
| 4 x 66.5 KiB (repeat) | 4.4 s | 9.3 s | 2.11x | 12.9x |
| 8 x 33 KiB | 3.4 s | 9.1 s | 2.72x | 13.1x |
| 50 x 5.3 KiB (file cap) | 3.3 s | 11.5 s | 3.46x | 10.4x |
| 2 x 128 KiB (maximal per file) | 4.5 s | 11.3 s | 2.52x | 10.2x |

Every legal shape completes far inside the deadline it earns, loaded, with all files reported `error` rather than `timed_out`. Observed load factor peaks at 3.46x, covered by LOAD_FACTOR 3 x DEADLINE_MARGIN 2.

HONEST CAVEAT, recorded in the constant so it is not 'corrected' later: this substrate runs at 12-17 ms/KiB, four to six times faster than the 75 ms/KiB the model is sized on. The model deliberately keeps the SLOWEST observed rate (the eval's 508 KiB / 37.8 s figure on denser markup). Being wrong fast costs a longer wait before declaring a stall; being wrong slow admits a request that cannot finish and returns `timed_out` for every file in it.

AC#5 — refusal semantics preserved and re-verified. A request over the cap is still refused WHOLE with `too_large` and nothing reported as checked, and the documented precedence (collision + oversize -> `too_large` wins) is unchanged. Incidentally confirmed during measurement: a 2-file batch of 136 KiB buffers came back `not_applicable` per buffer, so the per-buffer bound still fires inside a batch.

Regression coverage: `cost-model.spec.ts` asserts RELATIONSHIPS rather than values — the composition of the per-KiB deadline from its three factors, the rounding direction, exact invertibility at the boundary, both caps fitting inside the deadlines they earn, the single-file path landing exactly on the floor, and `MAX_BATCH_BYTES > MAX_BUFFER_BYTES`. A behavioural test in `validate-code.spec.ts` drives a 200 KiB batch under fake timers and asserts it is STILL RUNNING at the old 60 s floor and times out at the deadline its size earns, quoting that deadline in the message. Sabotage-verified: pinning the deadline back to the floor fails it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`MAX_BATCH_BYTES` was `4 * MAX_BUFFER_BYTES` = 512 KiB, a round multiple that inherited none of the deadline reasoning `MAX_BUFFER_BYTES` was derived from. It held until `FilterArity` added per-node work and moved throughput from ~55 to ~75 ms/KiB; after that the worst legal batch needed 60-113 s against a fixed 60 s deadline, and a lint timeout returns `not_applicable: timed_out` for EVERY file in the request — a large-but-legal changeset silently receiving no validation at all.

Fixed by writing the relationship down as arithmetic in a new `cost-model.ts`, and deriving both the deadline and the batch cap from it instead of choosing them. The deadline now scales with the bytes a request admits (floor 60 s, ceiling 120 s) and the cap is the largest request that still fits under the ceiling: 266 KiB. Every single-file call is unchanged — `lintDeadlineMs(MAX_BUFFER_BYTES)` is exactly the old 60 s.

Verified by measurement against a live project rather than by calculation: all five legal batch shapes complete in 3.3-4.5 s idle and 9.1-11.5 s under full CPU contention, 10x inside the deadline they earn, every file reported rather than timed out.
<!-- SECTION:FINAL_SUMMARY:END -->
