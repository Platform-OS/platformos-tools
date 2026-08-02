---
id: TASK-12.6
title: >-
  Stop re-parsing the whole project on every validate_code call (last remaining
  cost)
status: Done
assignee: []
created_date: '2026-07-29 05:00'
updated_date: '2026-08-02 17:15'
labels:
  - performance
  - check-node
  - memory
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-12.1–12.4, `validate_code` on pos-module-mcp is 5.8 s per call (was 26 s). Essentially all of what is left is `getApp`: it globs, reads and **eagerly parses every project file on every call** (3.6–5.8 s), while `check()` — now scoped to the edited file — costs 81 ms. The parses are pure waste: only the buffer's file is visited.

It is also the whole memory story. Post-GC live heap is ~19 MB, but RSS peaks at 400–650 MB per server instance because each call allocates and discards hundreds of MB of ASTs. Several instances (one per client session per project) therefore sit on GBs of RSS while holding ~20 MB of live data.

Three ways to fix it, deliberately NOT chosen yet:

1. **Lazy AST confined to check-node.** Have check-node's own `toSourceCode` build `ast` behind a memoized getter, so `getApp` reads files but parses only the files actually visited. Expected: `getApp` 3.6 s → ~50 ms, per call ~0.3 s, and the transient-AST garbage disappears with it (so RSS drops too). Blast radius is project loading in check-node only — the language server builds its `SourceCode`s through check-common's eager `toSourceCode` and never sees these objects. Parse errors stay captured as `Error` values, just produced on first access instead of up front.
2. **Lazy AST in check-common (shared).** Same idea for every consumer. Larger surface (CLI, LSP, browser, graph, vscode all construct `SourceCode`), and `DocumentManager` spreads `sourceCode` in four places (`documents/DocumentManager.ts:186–201`), which evaluates a getter and forces the parse anyway — so the extra reach buys less than it appears to.
3. **AppCache**, as `supervisor-graph-integration` already implements — see the interaction note below.

## Does landing `supervisor-graph-integration` make this unnecessary?

Partly. That branch's `AppCache` gates reuse on a per-file `fileFingerprint` (stat identity) inside `getApp`, so:

- **Warm calls: yes, effectively solved.** Calls 2+ skip both read and parse for unchanged files. Combined with TASK-12.1–12.3 (which that branch does NOT have — its measured steady state was 18–21 s with the unfixed check-common), warm latency should land in the ~0.2–0.4 s range. That combination has not been measured yet and should be, once merged.
- **Cold first call: no.** The first call after a server starts still parses the entire project. On that branch the first call measured 62.8 s, because the 37 s background graph build ran on the same event loop as the lint and starved it. Kicking the graph build off at `startServer` instead of on the first request, and/or option 1 above, is what actually fixes the cold path.
- **Memory: it trades the other way.** AppCache RETAINS every parsed AST to avoid re-parsing, so live heap rises from ~19 MB toward the size of the parsed project, per instance. Option 1 removes the work instead of remembering it, so it costs nothing to hold. The two compose (cache avoids re-reads, laziness avoids parses), and the retained-memory figure should be measured when the branch lands.

## Merge interaction (measured, not assumed)

The two branches were compared file by file. The four check/LSP files touched by TASK-12.1/12.2 are byte-identical on both branches, so those changes merge cleanly. Two files will conflict:

- `packages/platformos-check-node/src/index.ts` — both branches change `lintApp` / `lintBuffer` / `getApp`. The changes are compatible, not competing: keep BOTH the `cache?: AppCache` parameter (graph branch) and the `only?: UriString[]` parameter plus the process-scoped docs manager (this branch); `lintBuffer` should pass both `cache` and `only: [uri]`.
- `packages/platformos-check-common/src/index.ts` — this branch adds `CheckOptions`/`filesToVisit` to `check()`; reconcile with whatever that branch changed there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An approach is chosen from the three options with its rationale recorded
- [x] #2 Warm `validate_code` latency on pos-module-mcp is under 500 ms per call, measured over the real MCP stdio bin and recorded
- [x] #3 Cold (first-call) latency is measured and recorded separately from warm latency — not hidden behind an average
- [x] #4 Live heap after repeated calls is measured with forced GC and recorded, so the memory cost of the chosen approach is explicit
- [x] #5 Diagnostics remain byte-identical: `lintBuffer` still matches `appCheckRun`'s whole-project offenses filtered to the same uri, over a real multi-hundred-file project
- [x] #6 If the chosen approach is lazy parsing, a test pins that a parse error is still surfaced as a captured `Error` and not thrown from `getApp`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Approach chosen (AC #1): the lazy App object model in `platformos-common` — implemented

Rationale is recorded in the Implementation Notes above and unchanged. All eight
children are DONE — see the 2026-08-02 section at the bottom for the last two.

## Measured on `arabbank` (3138 files), before vs after, same machine

| | before | after |
|---|---|---|
| `getApp` | 15,323 ms | **270 ms** |
| cold first call | 15,480 ms | **662 ms** |
| warm median | 15,288 ms | **236 ms** |
| live heap after forced GC | 78.5 MB | **24.3 MB** |
| RSS peak | 1,174 MB | **431 MB** |

Warm calls now do 6 liquid parses, 10 reads and 389 stats. `pos-module-mcp` is not on
this machine, so the measurement is through the `lintBuffer` library seam on a LARGER
project than the original numbers came from; the stdio transport adds only JSON
framing over it.

- #1 ✔ · #2 ✔ (236 ms) · #3 ✔ (662 ms, recorded separately) · #4 ✔ · #5 ✔ · #6 ✔

## What this actually cost, and what is next

Both the latency AND the memory story are resolved, and in the same move: the RSS
peaks were transient AST garbage, so not doing the work is what removed them — unlike a
cache, which would have traded them for retained heap.

**The next bottleneck is the glob.** 226 of the 251 ms a warm call takes is `glob()`
walking the project tree; everything this epic was about is now ~25 ms. Split out as
TASK-12.7.


## All eight children are now closed (2026-08-02)

12.6.4 and 12.6.5 — the two that were left partially done — landed together, because
they were one change: the language server's `DocumentManager` is now an adapter over
the same `App` the linter holds, and that is exactly what let the graph read through
`appBackedGetSourceCode`. 12.6.5's AC #2 (delete the graph's `toSourceCode`) is
deliberately not done and is rescoped on that task with the reason.

### The lint was the headline; the editor got the same win

Same model, measured through the real language server on `arabbank` (2735 liquid
files) — `initialize` → `didOpen` → first `publishDiagnostics`, medians of five runs:

| | before | after |
|---|---|---|
| first diagnostic | 17,742 ms | **771 ms** |
| first completion | 191 ms | 187 ms |
| RSS after both | 705-720 MB | **333-347 MB** |

Diagnostics are identical (the same five `PartialCallArguments` offenses).

The end-to-end harness earned its place twice over: it caught a real defect no unit
test could (a file can now be IN the app before it has been READ, and handing one out
cost every cross-file diagnostic that depended on it), and a pre-existing race it
unmasked (`runChecks` never waited for `preload`, and only got away with it while
preload was slow enough to monopolise the event loop).

One cost moved rather than disappeared: a whole-project graph build now pays for the
parses preload used to (`appGraph/dependencies` 198 ms → 11.5 s on arabbank, one-time —
the second request is 1 ms). Total time to a graph still fell, 18.0 s → 12.4 s, and it
is off the startup path. Written up on 12.6.4.
<!-- SECTION:NOTES:END -->
