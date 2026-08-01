---
id: TASK-12.6
title: >-
  Stop re-parsing the whole project on every validate_code call (last remaining
  cost)
status: To Do
assignee: []
created_date: '2026-07-29 05:00'
updated_date: '2026-07-31 16:40'
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
- [ ] #1 An approach is chosen from the three options with its rationale recorded
- [ ] #2 Warm `validate_code` latency on pos-module-mcp is under 500 ms per call, measured over the real MCP stdio bin and recorded
- [ ] #3 Cold (first-call) latency is measured and recorded separately from warm latency — not hidden behind an average
- [ ] #4 Live heap after repeated calls is measured with forced GC and recorded, so the memory cost of the chosen approach is explicit
- [ ] #5 Diagnostics remain byte-identical: `lintBuffer` still matches `appCheckRun`'s whole-project offenses filtered to the same uri, over a real multi-hundred-file project
- [ ] #6 If the chosen approach is lazy parsing, a test pins that a parse error is still surfaced as a captured `Error` and not thrown from `getApp`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Approach chosen (AC #1): a lazy App object model in `platformos-common`

None of the three options above; they are all local fixes to one consumer. The
chosen approach is the one `platformos-common` was created for: reproduce the
Ruby `platformos-check` App model (`~/projects/lsp/platformos-check/lib/platformos_check/`
— `app.rb`, `app_file.rb`, `liquid_file.rb`, `storage.rb`) as the single source
of truth for what an app file IS, where it lives, and when its parse is stale.

### Why not options 1–3

There are FOUR live implementations of "the project's files, parsed", and every
option above fixes exactly one of them:

| Where | Shape | Eager? | Invalidation |
|---|---|---|---|
| `check-node getApp` | flat `SourceCode[]` | reads AND parses all | none — rebuilt per call |
| LSP `DocumentManager` | `Map<uri, AugmentedSourceCode>` | `preload` reads+parses all | open/change/close/delete/rename ✔ |
| `platformos-graph toSourceCode` | adds JS/asset types | eager | none |
| `AppCache` (`supervisor-graph-integration`) | fingerprint-gated `getApp` | retains parsed ASTs | stat fingerprint |

- Option 1 (lazy in check-node) leaves the other three untouched.
- Option 2 (lazy in check-common) was rated "buys less than it appears to"
  precisely because `DocumentManager` spreads the source object — see the
  blocker below. That is a fixable bug, not a reason to reject shared laziness.
- Option 3 (AppCache) remembers work instead of not doing it, so it trades
  latency for retained heap, per instance.

`DocumentManager` is the closest thing to the right model — it has versions and
rename tracking — but it is LSP-shaped, re-parses everything in `preload`, and
cannot serve check-node. TASK-12.15 (eliminate the graph/lint double parse)
exists only because this layer is missing.

### The model

In `platformos-common`, on top of the classification source of truth it already
owns (`FILE_TYPE_DIRS` → `TYPE_MATCHERS`, `getFileType`, `getAppPaths`/
`getModulePaths`, `AbstractFileSystem`):

| Ruby | TS |
|---|---|
| `Storage` | `AbstractFileSystem` (exists) |
| `App.new(storage)` → classify PATHS only | `App.fromPaths(rootUri, uris, fs)` — no reads |
| `grouped_files: {Class => {name => file}}` | `byUri: Map` + per-type `Map<name, AppFile>` |
| `AppFile#source` lazy / `#parse` memoized | `load()` async + `ast` SYNC memoized getter |
| `AppFile#name` (logical `render` name, `modules/X/` prefix) | derived from `FILE_TYPE_DIRS` prefix strip |
| `module_overwrite_file?` shadowing | `app/modules/X` shadows `modules/X` |
| `App#update(files, remove:)` | `update(uris)` / `remove(uris)` |
| `PartialFile`/`PageFile`/`YamlFile`… | `AppFile` subclasses per `PlatformOSFileType` |

### Three things that make this non-trivial

1. **Checks read `file.ast` synchronously** (`visitLiquid(file.ast, check)`,
   `onCodePathEnd(file & { ast })`). Async `ast` would touch every check. Use
   Ruby's own split: `load()` async (reads source), `ast` a sync memoized
   getter. `check()` then awaits `load()` only for the files it will visit and
   no check signature changes.
2. **`{...sourceCode}` forces the getter.** `DocumentManager.augmentedSourceCode`
   spreads the source object in ALL FOUR type branches
   (`documents/DocumentManager.ts`, verified). Spreading evaluates getters, so
   laziness dies silently there. Must become composition (`textDocument`
   alongside the `AppFile`, not spread into a copy). This is the blocker that
   made option 2 look weak.
3. **`platformos-common` sits BELOW the parsers.** Its deps are only `js-yaml`,
   `vscode-json-languageservice`, `vscode-uri`; `liquid-html-parser`,
   `jsonc/parse` and `yaml/parse` are in check-common above it. So `App` takes
   INJECTED parsers (a `Parsers` map keyed by type), the same way it already
   injects `AbstractFileSystem`. Keeps common browser-safe and lets the graph
   register its JS/asset parser instead of forking `toSourceCode`.

### What this retires

- Options 1 and 2 of this task, together — laziness lands in the model.
- TASK-12.15 (graph/lint double parse) — both hold the same `AppFile` instances.
- `AppCache` becomes a fingerprint-driven `App.update()`, not a second cache.
- `DocumentsLocator.locate()`'s per-call-site `stat` walk — measured ~40,000
  `stat` calls per whole-project run across the five checks that call it —
  becomes an O(1) lookup in the per-type name index.

### Found on the way

`platformos-check-common` imports `@platformos/platformos-common` in 20 source
files but does NOT declare it in its `package.json`; it resolves only through
workspace hoisting. Needs fixing regardless, and becomes load-bearing once `App`
lives there. Split out as 12.6.2.

### Children

12.6.1 model · 12.6.2 undeclared dep · 12.6.3 check-node · 12.6.4
DocumentManager · 12.6.5 graph · 12.6.6 locator index. 12.6.1 and 12.6.2 gate
the rest; 12.6.3–12.6.6 are independent of each other.
<!-- SECTION:NOTES:END -->

## Measurements carried over from the earlier close (2026-07-29)

This task was briefly closed as "superseded by 12.7/12.8" on the
`supervisor-graph-integration` branch before being reopened here with the lazy
App model. The narrative was superseded; the numbers were not, and they are the
baseline the new approach has to beat. Recorded so they are not re-measured:

- Warm `validate_code` on pos-module-mcp with `AppCache` wired: **0.9–1.0 s**
  (down from 26 s). First call with a persisted graph: **6.6 s** (AppCache cold →
  full project parse). First call with no persisted graph: **46–58 s** — the
  37.3 s graph build contends with the lint on one event loop.
- Memory: with `AppCache`, RSS settles at **848–940 MB** per instance. Without
  it, post-GC live heap plateaus at **~19.2 MB** with RSS ~404 MB (+0.5 MB/call
  — no leak, verified with forced GC over 8 calls). The retention is the cache's
  parsed ASTs, which is exactly what the lazy model removes rather than caches.
- Diagnostics unchanged: `lintBuffer` matched `appCheckRun`'s whole-project
  offenses filtered per uri across dna-idea (87/87 files), pos-module-mcp and
  poetry-blog — 0 mismatches, whole-project offense dumps byte-identical.

Later measurements on arabbank-master (2769 liquid / 3138 App files) put warm
`validate_code` at **684 ms**, of which `getApp` is **375 ms (~55%)** —
glob 210 ms, `fileFingerprint` 306 ms (3234 stats), isIgnored 41 ms. That is the
cost this task's name refers to, and it is now the dominant warm-path term.
