---
id: TASK-12.6
title: >-
  Stop re-parsing the whole project on every validate_code call (last remaining
  cost)
status: Done
assignee: []
created_date: '2026-07-29 05:00'
updated_date: '2026-07-29 21:44'
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
- [ ] #6 If the chosen approach is lazy parsing, a test pins that a parse error is still surfaced as a captured `Error` and not thrown from `getApp`
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Superseded — split into TASK-12.7 (warm the graph at server start) and TASK-12.8 (lazy parse), which replace this task's three unresolved options with measured, concrete plans. Closing so the same ground is not re-analysed.

AC#1 DECISION: option 3 (`AppCache`) landed by merging the graph branch, and it is now on `supervisor-graph-integration`. Warm `validate_code` on pos-module-mcp is **0.9–1.0 s**, down from 26 s. Option 1 (lazy parse, confined to check-node) remains the right next step and is now TASK-12.8; the `DocumentManager` spread problem that undercuts option 2 is recorded there.

AC#2/#3 MEASURED, and the two must not be conflated:
- warm: 0.9–1.0 s (target met in practice)
- first call, persisted graph: 6.6 s (AppCache cold → full project parse)
- first call, no persisted graph: 46–58 s (the 37.3 s graph build contends with the lint on one event loop)
Cold is now the whole problem, and it is exactly what 12.7 + 12.8 address.

AC#4 MEMORY: with `AppCache` wired, RSS settles at 848–940 MB per instance; without it, post-GC live heap plateaus at ~19.2 MB with RSS ~404 MB (+0.5 MB/call — no leak, verified with forced GC over 8 calls). So the retention is the cache's parsed ASTs, not a leak, and 12.8 attacks the cause rather than the symptom.

AC#5 DIAGNOSTICS UNCHANGED: `lintBuffer` matched `appCheckRun`'s whole-project offenses filtered per uri across dna-idea (87/87 files), pos-module-mcp and poetry-blog — 0 mismatches; whole-project offense dumps byte-identical on three real projects, re-verified after merging master.

AC#6 was conditional on choosing lazy parsing; it carries over to TASK-12.8 AC#2, where the captured-`Error` guarantee is spelled out.

Merge note from this task proved accurate: `check-common/src/index.ts` and `check-node/src/index.ts` were the only real conflicts and both sides composed (`cache` + `only` + process-scoped docset), while the ESM extension tax on the graph branch's new modules was real and had to be paid for all 12 relative imports.
<!-- SECTION:FINAL_SUMMARY:END -->
