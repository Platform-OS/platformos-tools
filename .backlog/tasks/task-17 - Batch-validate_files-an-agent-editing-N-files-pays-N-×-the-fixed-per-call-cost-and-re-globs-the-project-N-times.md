---
id: TASK-17
title: >-
  Batch validate_files: an agent editing N files pays N × the fixed per-call
  cost and re-globs the project N times
status: Done
assignee: []
created_date: '2026-07-31 09:52'
updated_date: '2026-07-31 11:20'
labels:
  - performance
  - mcp-supervisor
  - api
dependencies: []
modified_files:
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/overlay-file-system.ts
  - packages/platformos-check-node/src/lint-buffers.spec.ts
  - packages/platformos-mcp-supervisor/src/lint/lint-batch.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-files.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-files.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/server.ts
  - packages/platformos-mcp-supervisor/src/result/types.ts
  - packages/platformos-mcp-supervisor/test/integration/stdio-smoke.spec.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`validate_code` handles exactly one buffer. An agent making a multi-file change — the normal case for anything non-trivial — calls it once per file, and each call repeats the entire fixed cost against an unchanged project.

Measured on `pos-module-mcp` (idle box, after TASK-12.8/12.16):

```
warm validate_code median     332–346 ms
  of which FIXED per call:
    glob 1686 paths            61 ms
    isIgnored x 1686           49 ms
    loadConfig                 10 ms
    docDefinitions map (162)    — rebuilt per call
    enumerateEdgeSources      142 ms  (concurrent branch)
  of which per-BUFFER:        ~84 ms  (the buffer's own parse + checks)
```

So ~250 ms of every call is fixed cost that a batch would pay **once**. Twenty files today ≈ **6.8 s** and twenty full project globs; batched it should approach `250 ms + 20 × 84 ms ≈ 2 s`, and likely better since the per-buffer figure includes some shared setup.

This is now the largest remaining real-world latency win. Single-call latency is already ~340 ms and the remaining micro-optimizations are worth ~60 ms (see TASK-12.19, deprioritized) — an order of magnitude less than this.

## Why the engine already supports it

`CheckOptions.only` (TASK-12.3) is already a `UriString[]`, not a single URI. `check()` visits exactly the named files and nothing else. So a batch needs:

- overlay N buffers into the App instead of one, and
- pass all N URIs as `only`, and
- partition the resulting `Offense[]` back per file (each offense already carries `uri` — the single hardcoded `offenses.push` sets `uri: file.uri`).

One `getApp`, one `loadConfig`, one `JSONValidator`, one `docDefinitions` map, one `check()` run. No new engine capability is required, which is the main reason this is worth doing now.

## Design decisions to settle

1. **New tool vs extend the existing one.** A separate `validate_files` keeps `validate_code`'s contract untouched (and its result shape is per-file, so overloading one tool would mean a union return). Prefer a new tool; keep `validate_code` as the single-file ergonomic path, implemented over the same batch seam so there is one code path.
2. **Result shape.** A map or array of per-file `ValidateCodeResult`, plus a batch-level roll-up: `must_fix_before_write` true if ANY file blocks, so the agent has one gate to read.
3. **Applicability per file.** TASK-13's gate is per-file, so a batch containing one off-project path must decline THAT file (`not_applicable`) and still validate the rest — never fail the whole batch.
4. **Cross-buffer resolution.** This is the real prize beyond speed: with all N buffers overlaid, a new partial added in buffer A resolves for a `render` in buffer B. Today each single call sees only its own buffer plus on-disk files, so a coordinated multi-file edit reports `MissingPartial` for files that WILL exist. That is a correctness win, not just a performance one — and it is the thing to test hardest.
5. **Bounds.** Cap batch size and total bytes; a batch is a new way to hand the server unbounded work (see TASK-15).
6. **Impact.** Blast radius per file, from the one graph lookup — do not re-walk per file.

## Non-goals

- Do not change `validate_code`'s existing result shape.
- Do not make the batch atomic: a failure on one file must not sink the others.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `validate_files` accepts N buffers and returns a per-file result plus a batch-level `must_fix_before_write` roll-up
- [x] #2 `getApp`, `loadConfig` and the graph lookup happen ONCE per batch, asserted by instrumentation rather than inferred from timing
- [x] #3 Measured: a 20-file batch versus 20 single calls on a real project, before/after, on an idle box
- [x] #4 A partial added in one buffer resolves a `render` in another buffer in the SAME batch (the cross-buffer correctness win), and still reports missing when it is absent from both buffer and disk
- [x] #5 Per-file offense output for a 1-file batch is byte-identical to the equivalent `validate_code` call
- [x] #6 A batch mixing supported, off-project and unsupported paths declines only the individual files, validating the rest
- [x] #7 Batch size and total-byte caps are enforced with a determinate refusal
- [x] #8 `validate_code` is reimplemented over the batch seam (one code path) with its existing contract and tests unchanged
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The correctness win did NOT come for free — and that is the main finding

The task assumed overlaying N buffers into the `App` would make them visible to each other. It does not. `MissingPartial` and the other reference checks resolve names through `DocumentsLocator`, which asks **`context.fs.stat`** whether a candidate path exists — and `lintApp` passed the real `NodeFileSystem`. So a partial existing only as an unsaved buffer was still reported missing no matter how the `App` was assembled. The first run of the cross-buffer spec failed for exactly this reason.

Fixed with `overlayFileSystem(base, overlays)` in check-node: an `AbstractFileSystem` that presents buffers as existing files and falls through otherwise. The `App` overlay makes buffer CONTENT authoritative; this makes its EXISTENCE authoritative. **Both are required** — that is the non-obvious part of this task. `readDirectory` also tolerates a not-yet-existing directory, since a batch may create the first file in a new one.

## What was built

- `lintBuffers` in check-node (batch seam); `lintBuffer` reimplemented over it, so there is one code path — AC #8.
- `overlayFileSystem` + wiring through `lintApp`.
- `runBatchLint` adapter, re-keying results by the caller's own path string.
- `validate_files` tool + `ValidateFilesResult` (per-file entries, one batch gate).
- `MAX_BATCH_FILES = 50`, `MAX_BATCH_BYTES = 4 x MAX_BUFFER_BYTES`. The per-file bound alone was insufficient: 50 files just under it is ~6 MiB, ~6 minutes at the measured ~61 ms/KiB.

## Measured on a real 162-file project

```
20 x validate_code : 12189 ms
1 x validate_files :  2880 ms
speedup            : 4.2x

cross-buffer, single call : ["MissingPartial: 'mcp/xbuf_new' does not exist"]
cross-buffer, batch call  : []
```

An earlier run of that cross-buffer check appeared to fail; the cause was my own wrong test path (`mcp/x` resolves to `partials/x`, not `partials/mcp/x`), not a defect. Verified after correcting it.

## Two vacuous tests caught and removed

1. A stdio spec asserting cross-buffer resolution would have passed **either way**: that smoke project's hermetic config enables only `MissingContentForLayout`, so `MissingPartial` could never have fired. Removed, with a comment recording why; the real proof lives in check-node's `lint-buffers.spec.ts` where `MissingPartial` IS enabled — and it has a failing CONTRAST case (`the SAME edit linted one file at a time reports a false MissingPartial`) so it cannot pass as a no-op.
2. `vi.spyOn` on a check-node module export to count project loads: check-node binds its imports at load time, so the spy would never have intercepted. Replaced with a `CountingAppCache` subclass — public API, and it counts what actually matters (cache consultations per on-disk file, i.e. project passes).

## Fail-safe hardening from the self-audit

`resultFor` originally defaulted a missing lint entry to `[]` — which would report a file **clean that was never linted**, the exact false approval this area exists to prevent. Unreachable through `runBatchLint` (it seeds every key), but now returns "unknown" instead. Also pinned: two path strings resolving to one file, the same path twice, and that a systemic lint rejection propagates rather than reporting 20 clean files.

## Tests

29 new specs (10 check-node integration, 19 supervisor unit) plus stdio coverage. The speed claim is asserted **structurally** (one adapter call per batch, one project pass per batch) rather than by timing, so it cannot flake. Supervisor suite 179 → 214.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`validate_files` lints N buffers in one project pass: **4.2x faster** on a real project (20 files, 12.19 s → 2.88 s) and, more importantly, free of a false positive the single-file shape cannot avoid — a partial created alongside its caller is no longer reported missing.

The key finding is that the correctness win required more than the obvious change. Overlaying buffers into the `App` is not enough, because reference checks resolve existence through `context.fs`, not the `App`; a new `overlayFileSystem` in check-node was needed to make buffer existence authoritative as well as its content. The first cross-buffer spec failed until that landed.

`lintBuffer` is reimplemented over the same batch seam, so there is one code path. Batches are not atomic: every requested file gets an entry, per-file refusals decline only themselves, and `must_fix_before_write` is the OR over the files' own gates so a merely-unchecked file never blocks a changeset. Batch-level file-count and total-byte caps were added because the per-file bound alone allows ~6 MiB per request.

Two of my own tests were caught being vacuous and were fixed or removed, and a fail-safe was added where a missing lint entry would have read as "clean". 29 new specs; supervisor suite 179 → 214.
<!-- SECTION:FINAL_SUMMARY:END -->
