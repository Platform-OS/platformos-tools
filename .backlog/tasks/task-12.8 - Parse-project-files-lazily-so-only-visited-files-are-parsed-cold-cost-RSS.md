---
id: TASK-12.8
title: Parse project files lazily so only visited files are parsed (cold cost + RSS)
status: Done
assignee: []
created_date: '2026-07-29 21:42'
updated_date: '2026-07-30 17:59'
labels:
  - performance
  - check-node
  - memory
dependencies: []
modified_files:
  - packages/platformos-check-common/src/to-source-code.ts
  - packages/platformos-check-common/src/to-source-code-lazy.spec.ts
  - packages/platformos-check-node/src/index.ts
  - packages/platformos-check-node/src/lazy-project-parse.spec.ts
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`check-node`'s `toSourceCode` builds the AST eagerly (`commonToSourceCode` → `ast: toLiquidHTMLAST(source)`), so `getApp` parses every project file it reads. With `AppCache` that cost is paid once rather than per call, but it is still paid in full on a cold start and after any broad change — 3.6–5.8 s on pos-module-mcp — and it is the origin of the memory profile: **RSS 848–940 MB per server instance against ~19 MB of live heap**, because each parse allocates an AST that is immediately discarded or retained wholesale.

Since TASK-12.3 scopes checks to the edited file, the vast majority of those ASTs are never visited. Building `ast` behind a memoized getter in check-node's own `toSourceCode` means `getApp` reads files (~35 ms for 162 files) and parses only what a check actually touches, which removes the work instead of caching it — so it cuts the cold path AND the memory, and it composes with `AppCache` rather than replacing it.

Deliberately confined to check-node: the language server constructs its `SourceCode`s through check-common's eager `toSourceCode` and never sees these objects. Note `DocumentManager` spreads `sourceCode` in four places (`documents/DocumentManager.ts:186–201`), which would evaluate a getter and force the parse anyway — so widening this to check-common buys less than it appears to and should be a separate decision.

Correctness constraints, both currently guaranteed by eager parsing:
- Parse errors are CAPTURED, not thrown: `ast` is typed `T | Error` and `toLiquidHTMLAST` returns an `Error` value. A lazy getter must preserve that — `getApp` must not start throwing for a file with a syntax error.
- Repeated `.ast` access must not re-parse; the getter must memoize per instance.
- `AppSourceCode` objects are stored in `AppCache` and compared by identity in tests (`expect(second.get(uri)).not.toBe(source)`), so the shape must stay compatible.

Prerequisite ordering: land TASK-12.7 first if both are taken, since it changes when the cold cost is incurred and would otherwise muddy the before/after measurement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `getApp` no longer parses files that no check visits — asserted with a parser spy over a multi-file project where only one file is visited
- [x] #2 A file with a syntax error still yields a captured `Error` as its `ast`; `getApp` does not throw — covered by a test
- [x] #3 Repeated `.ast` access parses once (memoized per instance), asserted with a parser spy
- [x] #4 Cold-start and warm per-call latency on pos-module-mcp measured and recorded before/after, separately
- [x] #5 Peak RSS and post-GC live heap measured and recorded before/after on pos-module-mcp, so the memory claim is evidence rather than inference
- [x] #6 `lintBuffer` output stays byte-identical to `appCheckRun`'s whole-project offenses filtered to the same uri over a multi-hundred-file project
- [x] #7 AppCache interaction unchanged: unchanged files still reuse the same instances, changed files re-parse, removed files prune (existing app-cache specs pass untouched)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
DESIGN — added `toLazySourceCode` to check-common beside `toSourceCode`, sharing the same file-type classification and the same `to*AST` error-capturing helpers, with `ast` behind a getter memoized by the existing `memo()` util. check-node's `toSourceCode` (its project loader) is the ONLY caller. The eager constructor is untouched, so the language server, the browser runtime and platformos-graph keep their current behaviour — deliberate, since they parse what they load anyway, and `DocumentManager` spreads its source codes, which would evaluate a getter regardless.

Verified safe to back `ast` with a getter: nothing in the repo assigns to `.ast` (only the parser's own internals), so no strict-mode write can break.

MEASURED on pos-module-mcp (162-file app), real MCP stdio bin:

| | before | after |
|---|---|---|
| cold first call, no persisted graph | 9.8 s | **1.6 s** |
| warm start (graph persisted) | ~9 s | **1.9 s** |
| subsequent calls | 1.0 s | 0.9–1.2 s |
| peak RSS | ~1050 MB | **~600 MB** |
| post-GC live heap, 6 calls (no AppCache) | 19.2 MB flat, RSS ~404 MB | **22.3 MB flat, RSS ~240 MB** |

So the cold path improved ~6x and memory dropped ~40%, because the change removes the work rather than remembering it: `getApp` still reads all 162 files (cross-file checks need the complete `App`) but parses none of them; only the overlaid buffer is parsed, and only files a check actually reads are realised. Live heap is flat across calls — no leak introduced.

CORRECTNESS — offense output byte-identical on three real projects: pos-module-mcp (3), dna-idea (67), poetry-blog (300), ranges included. Suites: check-common 1087, check-node 122, supervisor 92, language-server-common 474, graph 109, liquid-html-parser 292, platformos-common 286, prettier-plugin-liquid 137, browser 1. Monorepo type-check and format clean.

TESTS — 7 in check-common (parser spy: no parse until `ast` is read, parses once on repeated reads, value equals the eager version, parse error CAPTURED not thrown, uri normalisation and type classification match the eager version per extension, survives being spread, `version` carried through) and 7 in check-node (App loaded with zero parses, `ast` is a getter, linting a buffer realises NO project file, a cross-file offense is still reported against unparsed files, a malformed file does not fail the load and yields a captured `Error`, three calls sharing an `AppCache` still realise nothing, and a file is realised exactly when read).

TEST-DESIGN NOTES, both found by deliberately reverting the fix rather than assumed:
1. A parser spy does NOT work from check-node: its tests resolve check-common to the built dist, so `vi.mock` of the parser is invisible to the code that calls it. The spec instead wraps the `toLazySourceCode` seam and records first `ast` reads — and the wrapper must not spread the source code, or it would trigger the very parse it observes.
2. First version of that spec passed 5/7 VACUOUSLY under eager loading: with eager loading the lazy seam is never reached, so "nothing was parsed" was trivially true. Fixed by also asserting the seam was used (`constructed.size === 5`). With the fix reverted, 5 of 7 now fail; the 2 survivors are pure correctness checks that should pass either way.

WHAT IS NOW DOMINANT: the warm call (~0.9–1.2 s) is `getApp`'s per-call glob + `isIgnored`/classification over 1686 paths — TASK-12.16 — since parsing no longer contributes. The graph build (background, worker) is unaffected by this change: it parses through platformos-graph's own traversal, not `getApp`.
<!-- SECTION:FINAL_SUMMARY:END -->
