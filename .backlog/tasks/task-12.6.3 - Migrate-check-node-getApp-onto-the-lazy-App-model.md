---
id: TASK-12.6.3
title: Migrate check-node getApp onto the lazy App model
status: To Do
assignee: []
created_date: '2026-07-31 16:41'
updated_date: '2026-07-31 16:54'
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
## The laziness ceiling: ~10 parses, but ~1000 reads

Measured/verified on the current branch. Lazy AST removes the parses, but two
`recommended` checks pull WHOLE-PROJECT data through `dependencies`, and neither
is an AST cost — so this task alone lands at ~0.3 s, not lower.

### What actually needs parsing (the good news)

| Need | Count on a 1400-file project |
|---|---|
| The visited file | 1 |
| Render/function targets via `getDocDefinition` + `PartialCallArguments` | 9 |
| **Total liquid ASTs** | **~10 (0.7%)** |

### What survives AST laziness

1. **`MissingPage` → `getRouteTable`** (`recommended: true`). `RouteTable.build()`
   calls `discoverPageFiles` then `fs.readFile` on EVERY page to read its
   frontmatter (slug/method/format) — ~170 ms, ~1000 `readFile` on a 1400-file
   project. This is reads, not liquid ASTs, so laziness does nothing for it.
   `makeGetRouteTable(fs, rootUri, injectedDependencies.routeTable)` already takes
   an existing table and the language server passes a persistent one
   (`startServer.ts`), but **check-node passes none, so it rebuilds per lint run**.
   Split out as 12.6.7 — do it alongside this task or the target is not reachable.

2. **`OrphanedPartial` → `getReferences`** (`recommended: true`). `getReferences`
   is wired ONLY in the LSP (`diagnostics/runChecks.ts`); check-node wires neither
   it nor `routeTable`. So in `validate_code` today the check returns early and
   reports nothing. Two consequences: laziness is safe right now, AND a
   recommended diagnostic is silently missing from `validate_code`. Critically,
   wiring the graph into check-node — which `supervisor-graph-integration` is
   heading toward — makes "is this partial referenced anywhere?" a whole-project
   parse and destroys this task's win. See 12.6.8 before wiring it.

3. `matching-translations` / `TranslationKeyExists` → `getTranslationsForBase` /
   `getDefaultTranslations` — a handful of YAML files. Not a problem.

### Consequence for this task's target

Do not claim the <500 ms AC on parse elimination alone. Measure with the route
table injected (12.6.7), and state the remaining read cost explicitly. If
`validate_code`'s primary use case is "validate a file before it is written",
then the steady-state cost of a warm process should be ~10 parses + 0 rebuilt
route tables — which needs both this task and 12.6.7.
<!-- SECTION:NOTES:END -->
