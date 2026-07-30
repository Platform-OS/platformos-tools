---
id: TASK-12.8
title: Parse project files lazily so only visited files are parsed (cold cost + RSS)
status: To Do
assignee: []
created_date: '2026-07-29 21:42'
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
- [ ] #1 `getApp` no longer parses files that no check visits — asserted with a parser spy over a multi-file project where only one file is visited
- [ ] #2 A file with a syntax error still yields a captured `Error` as its `ast`; `getApp` does not throw — covered by a test
- [ ] #3 Repeated `.ast` access parses once (memoized per instance), asserted with a parser spy
- [ ] #4 Cold-start and warm per-call latency on pos-module-mcp measured and recorded before/after, separately
- [ ] #5 Peak RSS and post-GC live heap measured and recorded before/after on pos-module-mcp, so the memory claim is evidence rather than inference
- [ ] #6 `lintBuffer` output stays byte-identical to `appCheckRun`'s whole-project offenses filtered to the same uri over a multi-hundred-file project
- [ ] #7 AppCache interaction unchanged: unchanged files still reuse the same instances, changed files re-parse, removed files prune (existing app-cache specs pass untouched)
<!-- AC:END -->
