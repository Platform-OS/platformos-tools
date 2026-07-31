---
id: TASK-16
title: >-
  No process-level error guards: one unhandled rejection kills the stdio server
  and the agent loses the tool silently
status: Done
assignee: []
created_date: '2026-07-31 09:51'
updated_date: '2026-07-31 09:56'
labels:
  - robustness
  - mcp-supervisor
  - reliability
dependencies: []
modified_files:
  - packages/platformos-mcp-supervisor/src/transport/process-guards.ts
  - packages/platformos-mcp-supervisor/src/transport/process-guards.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - >-
    packages/platformos-mcp-supervisor/test/integration/process-guards-survival.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`startServer` installs SIGINT/SIGTERM handlers but nothing for `unhandledRejection` or `uncaughtException` (verified by grep across `src/`). This is a long-lived stdio process that an agent holds open for a whole session.

Under Node's default, an unhandled rejection is fatal. So a single rejected promise on any fire-and-forget path takes the process down, and from the agent's side the tool simply stops existing — mid-session, with no diagnostic, because the death is not attributed to anything in the JSON-RPC stream.

The graph warm-up already has a defensive `.catch` for exactly this reason ("so that an instrumented or subclassed cache cannot turn this fire-and-forget into an unhandled rejection that takes the process down"). That reasoning is right and should be a process-level guarantee rather than one hand-placed catch.

## Fix

Install guards in `startServer` alongside the signal handlers, with the conventional and defensible split:

- **`unhandledRejection` — log loudly, keep serving.** A rejected promise on a background path does not imply the server's state is corrupt, and for a tool server staying up is strictly better than vanishing. Log the reason WITH its stack.
- **`uncaughtException` — log, attempt graceful shutdown, exit non-zero.** After an uncaught exception the process state may genuinely be corrupt, so continuing is not defensible. Reuse the existing idempotent `shutdown` so a graph build in flight is still reaped.

Hard constraint: **stdout is reserved for MCP JSON-RPC.** Guards must log via the existing stderr logger and must never write to stdout — a stray write corrupts the protocol stream, which would be a worse failure than the crash being handled.

## Design requirement for testability

`installSignalHandlers` currently calls `process.exit` directly, which makes it untestable without killing the runner. Extract the guards so that `exit` and the process emitter are injectable, and return an uninstall function. Then the handlers can be driven directly and their effects asserted — including that `exit` is called with a non-zero code — without terminating the test process.

Registering real listeners must also not leak across tests or across repeated `startServer` calls in one process.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An `unhandledRejection` is logged with its stack and the server keeps serving — a subsequent `validate_code` still answers
- [x] #2 An `uncaughtException` is logged, triggers the existing graceful `shutdown` (reaping any graph worker), and exits non-zero
- [x] #3 Neither guard ever writes to stdout (assert the stdout stream is untouched while a guard fires)
- [x] #4 `exit` and the process emitter are injectable; no test terminates the runner
- [x] #5 Guards are uninstallable, and repeated `startServer` calls in one process do not accumulate listeners (assert listener counts)
- [x] #6 A non-Error rejection value (string, undefined) is logged without the handler itself throwing
- [x] #7 Existing SIGINT/SIGTERM behaviour is unchanged and still covered
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

`src/transport/process-guards.ts` — `installProcessGuards({ log, shutdown, exit?, emitter? })`, returning an idempotent uninstall. It absorbed the inline `installSignalHandlers` so all four listeners have one owner and one injection seam.

- `unhandledRejection` → registered with **`on`, not `once`** (a `once` would silence every rejection after the first, the opposite of the intent); logs the stack; keeps serving.
- `uncaughtException` → logs, runs the existing idempotent `shutdown` so a graph worker in flight is still reaped, then `exit(1)` from a `finally` so a *failing* teardown still exits rather than wedging a process already declared unsound.
- `SIGINT`/`SIGTERM` → unchanged semantics (`once`, exit 0).

`shutdown` now calls `uninstallGuards()`, so a start/stop/start cycle in one process does not accumulate listeners.

## The renderer is total on purpose

`Promise.reject('nope')` and `Promise.reject()` are both legal, so `describe()` never assumes `.stack`. It also try/catches `String(value)` because **`String(Symbol())` throws** — a guard that throws while reporting a failure is worse than no guard. Both cases are pinned.

## Test discipline: a control, because the survival test could pass vacuously

The integration spec proves the real bin survives a background rejection. On its own that would prove nothing on a Node whose default for unhandled rejections is merely a warning — so the suite first establishes the premise:

```
CONTROL: node -e "Promise.reject(...); setTimeout(() => stdout.write('ALIVE'), 200)"
  -> exit status != 0, and 'ALIVE' never printed
```

Fatality confirmed in this exact runtime, so the server surviving the same shape is meaningful. Observed stderr from the real run:

```
[info] platformos-mcp-supervisor: unhandled promise rejection (server continues):
  Error: deliberate unawaited background rejection
    at Timeout._onTimeout (.../reject-after-boot.mjs:4:18) ...
[info] platformos-mcp-supervisor: validate_code: app/views/layouts/theme.liquid (full)
[info] platformos-mcp-supervisor: validate_code: app/views/layouts/theme.liquid (full)
```

Both post-rejection calls answered correctly (`MissingContentForLayout` then `ok`), which also covers "not left wedged".

21 new specs (18 unit, 3 integration). stdout is asserted untouched while both guards fire — a stray write there would corrupt the JSON-RPC stream, a worse failure than the crash being handled. Listener counts asserted at 1 per event, back to 1 after a lifecycle, 0 after uninstall.

Supervisor suite 135 → 156, all green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The stdio server no longer dies from a background rejection. `installProcessGuards` owns all four process listeners with an asymmetric policy: `unhandledRejection` logs the stack and keeps serving (a background rejection does not imply corrupt state, and for a tool server staying up beats vanishing), while `uncaughtException` logs, runs the existing graceful shutdown, and exits non-zero (state may be genuinely unsound).

Proven end to end against the real bin, with a control run first establishing that an unhandled rejection really is fatal in this runtime — without which the survival assertion would pass vacuously. The server logged the stack to stderr and answered both subsequent `validate_code` calls correctly.

`exit` and the emitter are injected so no test terminates the runner; uninstall is wired into `shutdown` so start/stop/start does not accumulate listeners. 21 new specs; supervisor suite 135 → 156.
<!-- SECTION:FINAL_SUMMARY:END -->
