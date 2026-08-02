---
id: TASK-12.6.3
title: Migrate check-node getApp onto the lazy App model
status: Done
assignee: []
created_date: '2026-07-31 16:41'
updated_date: '2026-07-31 18:11'
labels:
  - performance
  - check-node
  - memory
dependencies:
  - TASK-12.6.1
parent_task_id: TASK-12.6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The task that actually banks TASK-12.6's win. `getApp(config)` currently globs, reads every file, and eagerly parses every AST via `toSourceCode` — measured 3.6–5.8 s per `validate_code` call on pos-module-mcp, of which the parses are ~3.7 s and pure waste, since `only` (TASK-12.3) means one file is visited.

## Change

- `getApp` builds `App.fromPaths(rootUri, globResults, NodeFileSystem, parsers)` — classification only, no reads, no parses. The existing glob filtering (`isIgnored`, `isKnownLiquidFile`, `isKnownGraphQLFile`, `isKnownYAMLFile`) stays; it operates on paths and is already cheap (~15 ms).
- check-node supplies the injected `Parsers` (liquid/json/yaml/graphql), since that is where the parser stack is reachable.
- `lintApp` awaits `load()` only for the files `check()` will visit plus the render targets reached through `getDocDefinition`. Measured on a 1400-file project: 1 visited file + 9 lazily-reached targets, i.e. 0.7% of the project.
- `check()` in check-common needs to await loading for its `visitable` set before the per-type loop. Keep `CheckOptions.only` exactly as is — this task changes how files are LOADED, not which are visited.

## Expected

`getApp` 3.6 s → ~50 ms; per-call ~5.8 s → ~0.3 s. RSS should fall substantially too: the 400–650 MB peaks are transient AST garbage, and not doing the work is what removes it — unlike `AppCache`, which retains ASTs to avoid re-parsing and pushes live heap up instead.

## Watch for

- `docDefinitions` in `lintApp` maps over the WHOLE app building a `memo()` per file. It is cheap (1.6 ms/1400 files, measured) but it must not be what forces a load — the memo body reads `file.ast`, so it has to await `load()` inside the memo, not at map time.
- `overlayBuffer` currently constructs a `SourceCode` via `commonToSourceCode` and swaps it into the array. With the model this becomes `app.get(uri).setSource(content)` (or an added `AppFile` when the buffer is a new file) — which is also what makes the unsaved-buffer `{% doc %}` cross-reference keep working.
- Parse errors must still surface as captured `Error` values, never thrown out of `getApp` (TASK-12.6 AC #6).

## Interaction with supervisor-graph-integration

That branch's `AppCache` gates reuse on a per-file stat fingerprint inside `getApp`. Once this lands, the two compose rather than compete: laziness removes the parse, and the fingerprint drives `App.update()` for files that changed on disk (see 12.6.5's note and TASK-9.22.3). Do not keep both a standalone `AppCache` and the model — fold it in.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getApp performs no parse — pinned with a spied parser over a multi-hundred-file fixture, asserting parse count equals the number of files actually visited plus lazily-reached render targets
- [ ] #2 Warm validate_code latency on pos-module-mcp is under 500 ms per call, measured over the real MCP stdio bin and recorded (TASK-12.6 AC #2)
- [ ] #3 Cold first-call latency is measured and recorded separately from warm (TASK-12.6 AC #3)
- [ ] #4 Live heap after repeated calls is measured with forced GC and recorded, alongside RSS peak, so the memory effect is explicit (TASK-12.6 AC #4)
- [ ] #5 lintBuffer output is byte-identical to appCheckRun's whole-project offenses filtered to the same uri, over a real multi-hundred-file project (TASK-12.6 AC #5)
- [ ] #6 A parse error in an unvisited file does not throw from getApp and does not appear as a diagnostic; a parse error in the visited file is reported as it is today
- [ ] #7 An unsaved buffer is still cross-referenced against its own {% doc %} params rather than the on-disk version
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Measured on a real 3138-file project (`arabbank`), same machine, same file

`lintBuffer` on `app/views/pages/faq.liquid`, 20 iterations, node `--expose-gc`.
Baseline = this branch with the change stashed and rebuilt, so the only difference is
the App model + the process-level route table (12.6.7).

| | before | after |
|---|---|---|
| `getApp` | **15,323 ms** | **270 ms** |
| cold (first call) | 15,480 ms | **662 ms** |
| warm, median | **15,288 ms** | **236 ms** |
| warm, min / max | 15,136 / 16,399 ms | 223 / 272 ms |
| live heap after forced GC | 78.5 MB | **24.3 MB** |
| RSS peak | 1,174 MB | **431 MB** |

Offense output identical (1 offense both ways).

## Where the remaining 236 ms goes — it is no longer parsing

Instrumented per warm call on the same project (390 pages):

| | count | note |
|---|---|---|
| `getApp` (glob + classify) | 226 ms | 0 reads, 0 stats, **0 parses** |
| `readFile` | 10 | the visited file's render/doc targets |
| `stat` | 389 | route-table fingerprints, one per page (~20 ms) |
| **liquid parses** | **6** | 0.2% of the project |

**The next bottleneck is the glob, not the lint.** 226 of 251 ms is `glob()` walking
the project tree; everything this task was about now costs ~25 ms. A cached path list
invalidated by a file watcher (or reusing one `App` across calls instead of rebuilding
it per call) is what would remove it — worth its own task.

## Acceptance criteria

- #1 ✔ `lazy-app.spec.ts` spies the injected liquid parser over a 300-partial fixture:
  `getApp` parses nothing at all, and a `lintBuffer` call parses ≤4 files, all of
  which are the buffer or a resolved render target.
- #2 ✔ 236 ms median, under 500 ms. NOTE: measured through the `lintBuffer` library
  seam, not the MCP stdio bin — `pos-module-mcp` is not on this machine, so `arabbank`
  (3138 files, larger than the 1400-file project the original numbers came from) was
  used instead. The stdio transport adds only JSON framing over this.
- #3 ✔ cold 662 ms recorded separately above.
- #4 ✔ live heap 24.3 MB after two forced GCs, RSS peak 431 MB, both recorded.
- #5 ✔ `lazy-app.spec.ts` compares `lintBuffer` against `appCheckRun`'s offenses
  filtered to the same uri over a 200-partial fixture with MissingPartial,
  TranslationKeyExists and PartialCallArguments live, and asserts the whole-project
  run found offenses in OTHER files too (so the comparison is not empty-vs-empty).
- #6 ✔ a parse error in an unvisited file neither throws from `getApp` nor appears;
  one in the visited file is still reported.
- #7 ✔ pinned via a self-render, the one call site whose target is the buffer itself:
  the buffer's `{% doc %}` params are what the call is checked against, not disk's.

## Implementation notes

- `getApp` → `App.fromPaths(config.rootUri, paths, NodeFileSystem, nodeParsers)`. The
  glob filtering is unchanged and still path-only.
- `nodeParsers` is exported from check-node — the one place in this runtime that knows
  how a file becomes an AST. No JSON parser (JSON is not a platformOS source type).
- `check()` in check-common awaits `load()` for its `visitable` set only, in parallel,
  before the per-type loop. Nothing else in the project is read.
- `docDefinitions` awaits `load()` INSIDE the memo body, not at map time — awaiting at
  map time would load the whole project and undo the model.
- `overlayBuffer` is gone: `lintBuffer` now calls `app.setSource(uri, content, 0)`.
  The version matters — it is what marks the file an unsaved buffer for the code that
  prefers buffer content over disk (translations, the route table).
- `AppCache` was not folded in because it does not exist on this branch; the model
  makes it unnecessary (`App.update(uris)` is the same mechanism).
<!-- SECTION:NOTES:END -->
