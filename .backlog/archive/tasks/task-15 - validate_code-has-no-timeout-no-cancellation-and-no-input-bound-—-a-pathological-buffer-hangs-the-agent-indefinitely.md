---
id: TASK-15
title: >-
  validate_code has no timeout, no cancellation and no input bound — a
  pathological buffer hangs the agent indefinitely
status: Done
assignee: []
created_date: '2026-07-31 09:51'
updated_date: '2026-07-31 10:33'
labels:
  - robustness
  - mcp-supervisor
  - reliability
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/deadline.ts
  - packages/platformos-mcp-supervisor/src/deadline.spec.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.ts
  - packages/platformos-mcp-supervisor/src/adapter-input.spec.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/src/result/assemble.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

There is no `AbortSignal`, no timeout, and no input-size bound anywhere in `platformos-mcp-supervisor` (verified by grep across `src/`). Every other failure mode in the server degrades gracefully — a failed graph build reports `unavailable`, a missing graph reports `computing`, an off-project path now reports `not_applicable` — but a slow or pathological `validate_code` call degrades not at all. It simply never returns.

The agent is then blocked with no recourse: MCP has no server-advertised deadline, so unless the client implements its own timeout, the tool call hangs for the life of the session.

## What is and is not achievable

Be honest about this up front, because a naive `Promise.race` would look like a fix and mostly not be one:

- **The lint CANNOT be interrupted mid-flight.** Parsing is synchronous CPU work on the one event loop; a timer cannot preempt it. Racing a timeout returns control to the caller but the work continues to completion, still burning the core and holding its allocations.
- **What a timeout DOES buy** is exactly the stated failure mode: the agent stops waiting. That is worth having on its own.
- **PEG parsing terminates**, so the leaked computation is bounded by input size rather than unbounded. This is precisely why an input-size bound is the load-bearing half of the fix: bound the input and the worst case is bounded too.
- **True cancellation needs the lint on a worker thread**, where it can be terminated. The package already has that machinery for the graph build (`build-in-worker.ts`, `terminateGraphBuildWorkers`). Out of scope here; record it as the eventual fix.

## Fix

1. **Input-size bound** — refuse a buffer above a documented byte limit BEFORE parsing. This is the prevention; the timeout is the backstop.
2. **Deadline on the orchestration** — the call returns a determinate result within a bounded time regardless of what the adapters do.
3. **Impact deadline** — the impact branch already degrades, so give it its own shorter deadline and let it report `unavailable` rather than extend the critical path. Unlike lint this one is genuinely safe to abandon: the result is discarded.
4. **Machine-readable refusal reason.** `not_applicable` currently distinguishes its cases only in `next_step` prose. Add an additive `not_applicable_reason` enum (`outside_project` | `unsupported_type` | `too_large` | `timed_out`) so an agent can branch without parsing English. This is an agent surface; prose alone is not a contract.

Reuse `not_applicable` for all four rather than inventing a status per case: the invariant "NOT checked — neither an approval nor a reason to block the write" holds exactly for a timeout and an oversized buffer too. `must_fix_before_write` stays `false` — blocking a write because our own validation failed would make the tool a liability, and it matches how impact already degrades.

## Non-goals

- Do NOT move the lint to a worker thread here. Note it as the path to real cancellation.
- Do NOT block the write on a timeout or an oversize refusal.
- Do NOT let the timeout value be so tight that a legitimately slow cold call on a large project trips it — cold first calls are ~800 ms today and a big project will be slower.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A buffer over the size bound returns `not_applicable` / `too_large` with `must_fix_before_write: false`, and is refused BEFORE any parse (assert no lint adapter invocation)
- [x] #2 A lint adapter that never settles yields a determinate `not_applicable` / `timed_out` result within the deadline, rather than hanging
- [x] #3 A slow impact adapter degrades to `status: 'unavailable'` on its own deadline without delaying the lint result
- [x] #4 The timeout does NOT set `must_fix_before_write: true`
- [x] #5 `not_applicable_reason` is populated for all four cases and is absent on ok/warning/error results
- [x] #6 Every existing timing-sensitive path still passes: a normal warm call is unaffected and no deadline fires during the full suite
- [x] #7 Deadlines are configurable (constants at minimum) and documented with the measured baseline they were chosen against
- [x] #8 No timer keeps the process alive after a call settles (assert no leaked handles / `unref` or explicit clear)
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

- `src/deadline.ts` — `withDeadline(work, ms)` returning a unique `TIMED_OUT` symbol. Timer cleared on BOTH outcomes and `unref`'d, so a pending deadline cannot hold a stdio server open. Rejections pass through untouched (the lint is the primary gate; swallowing its failure would turn a real error into a silent pass).
- `MAX_BUFFER_BYTES` + `bufferTooLarge` in `adapter-input.ts`, checked in bytes.
- `NotApplicableReason` (`outside_project` | `unsupported_type` | `too_large` | `timed_out`) and `Declined` in `result/types.ts`; `not_applicable_reason` on the result. `Declined` lives in the contract so `result/` does not depend on the adapter layer.
- `LINT_DEADLINE_MS = 30_000`, `IMPACT_DEADLINE_MS = 2_000` in the handler.

## The finding that changed the design

The task assumed a deadline would be the backstop and the bound merely prevention. **End-to-end verification proved the deadline is far weaker than that.** A legal 400 KiB buffer against a 30 s deadline returned after **45 s** — because the parse is synchronous, so the deadline timer cannot even *fire* during it. The deadline is therefore only useful for ASYNC stalls (a wedged fs call, a hung graph lookup); against CPU-bound input the bound is the *only* guard.

Two further cliffs, measured, that no JS-level handler can survive:

```
1 MiB  -> ~30 s parse
2 MiB  -> RangeError: Maximum call stack size exceeded   (ohm CST->AST recursion)
4 MiB  -> native V8 abort                                (uncatchable, TASK-16's guards cannot help)
```

## The constant was wrong first time, and e2e caught it

Initially sized at 512 KiB from `toLiquidHtmlAST` in isolation (~19 s). But parsing is only part of a lint — every enabled check then walks the AST. Measured `lintBuffer` against the real 162-file project:

```
 16 KiB ->  1.2 s      128 KiB ->  7.1 s   <- the bound
 32 KiB ->  2.7 s      192 KiB -> 11.7 s
 64 KiB ->  3.7 s      256 KiB -> 15.6 s
```

~61 ms/KiB — 3x the parse-only figure. So 512 KiB would have let a *legal* buffer blow the deadline, which is precisely the failure the task said to avoid ("a deadline that fires on a legitimately slow call is worse than none"). Corrected to **128 KiB**: worst legal buffer ~7 s isolated / ~10 s observed end to end, 3x inside the deadline, while still admitting 1.7x the largest real source file found locally (a 76 KiB icon-sprite partial).

## Verified end to end (rebuilt bin, real project)

```
normal (warm)          |   405 ms | error          | -          | must_fix: true
76 KiB (largest real)  |  6215 ms | warning        | -          | must_fix: false
128 KiB (at bound)     |  9979 ms | warning        | -          | must_fix: false
129 KiB (over bound)   |     4 ms | not_applicable | too_large  | must_fix: false
4 MiB (would abort V8) |   240 ms | not_applicable | too_large  | must_fix: false
server still alive: true
```

Before the fix the same 400 KiB case took 45 s and the 4 MiB case would have aborted the process.

## Subtle hazard handled

When the deadline wins, the lint promise is **still running and unobserved** — a later rejection would become an unhandled rejection (and before TASK-16, would have killed the server). The handler attaches a logging `.catch` to the abandoned work. Pinned by a spec that installs a real `unhandledRejection` listener and asserts it never fires.

## Test discipline

31 new specs (9 deadline, 5 size bound, 9 handler-level bounded-work, plus updates). Sabotaged both halves:

- size guard disabled → **1 of 1** oversize spec fails
- both deadlines removed → **5 of 5** deadline specs fail, each by hanging to the 5 s vitest timeout, which is exactly the failure mode being prevented

`withDeadline`'s documented limitation is itself pinned by a spec asserting the abandoned work continues — so nobody later mistakes it for real cancellation.

Supervisor suite 156 → 179.

## Follow-up worth recording

True cancellation needs the lint on a worker thread, where it can be terminated; the package already has that machinery for the graph build (`build-in-worker.ts`). Also note a 128 KiB file still costs ~10 s — TASK-12.18 (monomorphizing the parameterized tag rules) is the lever on that, not this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`validate_code` is now bounded in both dimensions: a 128 KiB input limit refused before parsing, and 30 s / 2 s deadlines on the lint and impact branches. A declined or abandoned call returns `not_applicable` with a machine-readable `not_applicable_reason`, never `must_fix_before_write: true` — refusing to judge must not block a legitimate write.

The important discovery is that the deadline is much weaker than the task assumed: a synchronous parse blocks the event loop, so the timer cannot fire during it (a legal 400 KiB buffer returned after 45 s against a 30 s deadline). The input bound is the real guard, and it had to be re-sized from 512 KiB to 128 KiB after measuring the FULL lint (~61 ms/KiB) rather than the parse alone. Beyond ~2 MiB the parser throws inside ohm's recursion and at 4 MiB produced a native V8 abort that no handler can catch — so only a pre-parse bound helps.

Verified against the rebuilt bin on a real project: oversized buffers refused in 4–240 ms, the worst legal buffer validated in ~10 s, warm calls unchanged at ~405 ms, server alive throughout. 31 new specs; both halves sabotage-tested (the deadline specs fail by hanging, which is the failure being fixed). Supervisor suite 156 → 179.
<!-- SECTION:FINAL_SUMMARY:END -->
