---
id: TASK-74
title: >-
  Make platformos-common the source of truth for project state: parsing, derived
  metadata and one invalidation story
status: Done
assignee:
  - '@claude'
created_date: '2026-08-09 17:55'
updated_date: '2026-08-11 19:29'
labels:
  - architecture
  - platformos-common
  - research
  - caching
  - performance
dependencies: []
references:
  - packages/platformos-common/src/app/AppFile.ts
  - packages/platformos-common/src/app/App.ts
  - packages/platformos-common/src/app/types.ts
  - packages/platformos-common/src/app/package-boundaries.spec.ts
  - packages/platformos-check-common/src/utils/bounded-cache.ts
  - >-
    packages/platformos-check-common/src/checks/unknown-property/shape-analysis.ts
  - >-
    packages/platformos-check-common/src/checks/partial-call-arguments/extract-undefined-variables.ts
  - packages/platformos-check-common/src/liquid-doc/in-scope-names.ts
  - packages/platformos-language-server-common/src/TypeSystem.ts
  - packages/platformos-check-node/src/shared-app.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Outcome wanted

`@platformos/platformos-common` becomes the single place that knows what the project contains, what each file parses to, what has been DERIVED from that parse, and when any of it stops being true. Every consumer — the linter, the language server, the graph, the MCP supervisor — reads through it instead of keeping a cache of its own.

The value is not speed, it is that **invalidation stops being N separate stories**. Today each consumer memoizes derived work in its own module-level cache with its own key and its own freshness rule, and getting one of those rules subtly wrong is invisible: the answer is merely stale, never wrong-looking. Two such defects shipped on the `improve-shape-analysis` branch alone — a memo whose revalidation read from disk while the analysis read the open editor buffer (stale shapes for a whole editing session), and a memo whose key omitted the analyzer dependencies an entry was computed with (two consumers serving each other wrong answers). Both are structurally impossible for anything hung off the file that owns the source.

**The constraint that shaped the current design has been lifted.** `platformos-common` deliberately depends on no workspace parser package — pinned by an exact-list test in `app/package-boundaries.spec.ts` — which is why `Parsers` are injected and `AppFile.ast` is typed `unknown`. The repo owner has explicitly authorised taking `@platformos/liquid-html-parser` as a dependency there. That does not make the move automatically right: the boundary also buys browser-safety and the property that the LSP, linter and graph share ONE set of file objects rather than three. This task is to find out what actually moves, what cannot, and what it costs.

## START HERE: `toLiquidHtmlAST` in a check is the smell

A check importing `toLiquidHtmlAST` from `@platformos/liquid-html-parser` is doing its own parsing, and a check should almost never need to — the `App` holds the parse of every project file already. Grepping for it is the fastest way into this task. Every site below is real as of 2026-08-09, and they are NOT all the same thing; the research has to separate them rather than delete them as a class.

**Parses a PROJECT FILE — the App can almost certainly own these:**

- `checks/nested-graphql-query/index.ts:79` — the clearest case: does its own `fs.readFile` AND its own parse of a located file, so it bypasses the App twice.
- `checks/unknown-property/index.ts:90` — the `readPartial` fallback for a URI the App does not hold.
- `checks/partial-call-arguments/extract-undefined-variables.ts:127` — the bare-source path. Callers holding a file now go through `undefinedVariablesOf`, which memoizes on the `AppFile`; this is what is left for a source with no file behind it.
- `platformos-language-server-common/src/TypeSystem.ts:1646` — the same fallback shape in `readLiquidFile`.
- `platformos-check-node/src/backfill-docs/{index,doc-updater}.ts` — a CLI reading and parsing files itself.

**Does NOT parse a project file — these have to stay, and a rule that removes them is wrong:**

- `checks/deprecated-tag/index.ts:151` — parses a SYNTHESISED one-tag probe string to ask whether a replacement tag's grammar accepts some markup. There is no file.
- `checks/valid-html-translation/index.ts:31` — parses an HTML fragment embedded in a YAML translation value.
- LSP `LiquidCompletionParams.ts:112` and `HtmlElementAutoclosingOnTypeFormattingProvider.ts:96` — parse MODIFIED buffer text (a placeholder inserted at the cursor, autoclosing applied), which by definition is not what the file holds.

The legitimate one is `check-common/src/to-source-code.ts:20`, which is the parser injected into the `App`.

**A hand-rolled read is what forces a hand-rolled parse**, so `fs.readFile` in a check is the same smell one step earlier — `nested-graphql-query` shows both together. Find those too.

## Where things stand today (a starting inventory, not a complete one)

- `AppFile` owns `source`, a per-version memoized `ast`, and `derived(key, compute)` — a metadata memo dropped by the same two lines that drop the parse (`setSource`, `invalidate`). The seam this task would build on already exists and has one consumer.
- `createBoundedCache` (check-common) is an LRU with three remaining consumers, each keyed differently: the `DeprecatedTag` grammar probe (keyed on markup text, no file), the `UnknownProperty` partial-analysis memo (keyed on partial URI + bindings + analyzer identity + schema, with an `isStale` re-read), and the GraphQL schema cache (capped at 1).
- `liquid-doc/in-scope-names.ts` holds a WeakMap keyed on the docset's objects array.
- `undefinedVariablesOf` memoizes on the `AppFile`; `extractUndefinedVariables` is the unmemoized escape hatch beside it. This pair is the worked example of the shape this task is proposing, and the one to check first — it was a content-keyed LRU until 2026-08-09, and moving it onto the file removed the key, the copy of every source, and the eviction policy at once.
- The language server has its own buffer-first read path (`readSource`, `readLiquidFile`, `DocumentBackedFileSystem`); check-node has `getSharedApp` with `MAX_RETAINED_FILES` eviction and `stat`-based revalidation.

**Verify each cache rather than reading its key and trusting it.** Every staleness bug on the `improve-shape-analysis` branch survived review of the key; what caught them was editing the input and watching the answer fail to change.

## Known hazards to answer, not assume

- **Package cycles.** check-common depends on platformos-common. Any analysis moved down must not need to import back up. Some cannot move for this reason alone — anything whose input is the DOCSET (`platformosDocset.objects()`, the SDL) is injected into check-common at run time and is not a property of the file.
- **Browser safety and bundle size.** The vscode web extension and the CodeMirror playground build from these packages; `package-boundaries.spec.ts` records browser-safety as a reason for the current dependency list.
- **The shared file-object property.** `platformos-graph` injects a JS parser through `Parsers`. Whatever replaces injection must keep the graph, the LSP and the linter on one set of file objects.
- **Eviction.** `AppFile`-hung metadata is bounded by the App's own retention. Moving more onto files changes what an eviction costs to rebuild; that is a measurement, not a guess.

## How to judge it

Measure, do not reason. This repo baselines against `~/projects/pos` (arabbank, Accala-MP, htevent, pos-module-community); whole-project offenses must be byte-identical across any change, and CPU time — not wall clock, the machines are shared — is the honest speed signal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A written recommendation exists and states a decision — move, move in part, or do not move — with the measured evidence behind it, so the next person inherits the answer and not the question
- [x] #2 Every parse and every derived-metadata cache in the monorepo is inventoried with its key, its freshness rule, its bound and its consumers; the inventory is verified against the code rather than assembled from memory
- [x] #3 For each analysis, the inventory records whether it can be owned by platformos-common, and for each one that cannot, names the blocking reason (docset input, package cycle, browser safety, or other)
- [x] #4 The consequences for browser builds are measured, not assumed: the vscode web extension and CodeMirror playground still build, and any bundle-size change is recorded
- [x] #5 The property that the language server, linter and graph share one set of file objects is shown to survive, including the graph's injected JS parser
- [x] #6 No package dependency cycle is introduced, verified by a check that fails if one appears
- [x] #7 Any spike or prototype is validated against the ~/projects/pos corpus: whole-project offenses byte-identical, CPU time and retained memory recorded before and after
- [x] #8 The migration is broken into independently deliverable and independently verifiable steps, each small enough to review in one sitting, with the ordering and any dependencies between them stated
- [x] #9 package-boundaries.spec.ts is either updated so its dependency list and its stated rationale match the new architecture, or left intact with the reason it still holds recorded
- [x] #10 Every `toLiquidHtmlAST(` call outside the parser package is accounted for, each classified as either a parse of a PROJECT FILE the App can own, or a parse of something that is not a project file and must stay; the classification is justified per call site rather than applied as a rule
- [x] #11 Every check that reads a project file through `fs.readFile` rather than through the App is found and listed, since a hand-rolled read is what forces a hand-rolled parse
- [x] #12 Each cache in the inventory is verified by an actual staleness probe — edit the input, confirm the answer changes — not by reading its key and reasoning that it must be sound
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approved scope

Full research INCLUDING the spike (phase E). Written recommendation lands as a Backlog
**document**, linked from this task; the task's Notes carry the decision in one paragraph
and point at it.

## Correction to the task's premise, carried into the plan

`@platformos/liquid-html-parser` has no workspace dependencies (`line-column`, `ohm-js`
only), so `platformos-common -> liquid-html-parser` can create no cycle and is
browser-safe. But that dependency is NOT what fixes the `toLiquidHtmlAST` smell: every
"bypasses the App" site bypasses it by not LOOKING THE FILE UP (`app.get` /
`findOrLocate`), not because parsers are injected — `unknown-property/index.ts:75`
already does the App-first lookup with a parse only as fallback. And the invalidation win
(`AppFile.derived`) already works with `ast: unknown`; `undefinedVariablesOf` is the
proof. So the dependency buys TYPING, and the two outcomes the task wants are reachable
without it. This is the hypothesis the spike must test, not a conclusion.

## Phases

**A. Inventory** (AC 2, 3, 10, 11)
Every parse and every derived-metadata cache in the monorepo, recorded with key, freshness
rule, bound, consumers, whether platformos-common can own it, and the blocking reason when
it cannot. Every `toLiquidHtmlAST(` call outside the parser package classified per site
(project file vs not). Every project-file `fs.readFile` in a check listed.
Sites found in the opening sweep (to be verified, not trusted):
`AppFile.ast`/`derived`, `analysisCache`+`schemaIds` (shape-analysis), `probeCache`
(DeprecatedTag), `schemaCache` (graphql-schema), `inScopeNamesByObjects`,
`matchersByConfig` (ignore), `ModuleCache` (graph), `CachedFileSystem`,
`DocumentManager.apps`/`views`, `TypeSystem`'s `once`/`memo` set, `expandedPathsCache`
(DocumentsLocator), `translationsCache` (TranslationProvider), `getSharedApp` fingerprints,
`AugmentedPlatformOSDocset` memos, `graph/augment.ts` `getSourceCode` memoize.

**B. Staleness probes** (AC 12)
One probe per cache: edit the input, confirm the answer changes. Sabotage first — break the
code and confirm the probe fails — so no probe is decorative. Cheap and meaningful ones land
as regression tests; the rest are recorded in the write-up with their commands.

**C. Baselines** (AC 4, 7)
- vscode web extension + CodeMirror playground build; bundle sizes recorded.
- Whole-project lint over `~/projects/pos/{arabbank,Accala-MP,htevent,pos-module-community}`:
  offenses byte-identical hash, CPU time (not wall clock), peak RSS.

**D. Cycle guard** (AC 6)
A spec that builds the workspace dependency graph and fails if it ever has a cycle.
`workspace-dependencies.spec.ts` today only pins that imports are DECLARED.

**E. Spike**
Prototype what A says is worth moving, measured against C. Two independent moves to test
separately, because they have different costs:
1. derived-metadata onto `AppFile.derived` (needs no new dependency),
2. `platformos-common` taking `liquid-html-parser` so `AppFile.ast` types concretely.

**F. Write-up** (AC 1, 8, 9)
Decision (move / move in part / do not move) with the measured evidence; the migration as
independently deliverable, independently verifiable steps with their ordering; and a verdict
on `package-boundaries.spec.ts` — updated to match, or left intact with the reason recorded.

## Known incidental findings to fold in

- `shape-analysis.ts:922` justifies `clearShapeAnalysisCaches` by pointing at
  `clearUndefinedVariablesCache`, which no longer exists (that memo moved onto `AppFile` on
  2026-08-09). `clearShapeAnalysisCaches` itself has no caller in the monorepo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome: MOVE IN PART — full write-up in **doc-1**

`.backlog/docs/` holds the decision, the inventory of all 22 caches, the per-site
classifications, and every number. Summary of what it concludes:

**The task's premise needed correcting, and that is the most useful finding.** Taking
`@platformos/liquid-html-parser` into platformos-common is NOT what stands in the way.
`AppFile.derived` already works with `ast: unknown` (`undefinedVariablesOf` is the proof,
sabotage-verified), and the App-bypassing parse sites bypass it by not LOOKING THE FILE UP,
which injection has nothing to do with. Both outcomes the task wanted are reachable with no
dependency change at all.

- **Spike 1 (take the parser): measured, then rejected.** +881 B on the web bundle
  (+0.010 %), no CPU change, offense multiset identical, no cycle — cheap, and pointless.
  Its only real payoff is a typed `AppFile.ast`, which is not a one-package move: `JSONNode`
  (YAML + JSON) lives in check-common. Reverted.
- **Spike 2 (`AppFile.revision` + `ShapeAnalyzerDeps.revisionOf`): kept, in the working
  tree.** 25 414 (arabbank) / 16 033 (htevent) revalidations per whole-project run stop
  re-reading files and compare an integer instead — measured `byContent: 0`. Offense
  multiset identical on all four projects; CPU unchanged. Justified on CORRECTNESS: the
  ceiling was measured FIRST — deleting revalidation entirely, which is unsound, buys 1-2 %
  — so the case is that it replaces a comment-enforced rule ("`readContent` must read from
  the same place `readPartial` does") that had already been broken once.
- **18 of 22 caches cannot move**, each with a named reason (docset input 5, non-file
  identity 6, per-build/per-request by design 4, Node-only 1, LSP/config lifecycle 2); 4 are
  already in platformos-common. `analysisCache` is the one that wanted the move and could
  not take it: its dependencies are TRANSITIVE, and `derived` drops only on its own file's
  change.

## The corpus oracle this repo gates on is INVALID as practised

Hashing the CLI's report is not a valid "offenses byte-identical" check: **the report is not
byte-stable across runs of the same build.** Three runs of Accala-MP on one build gave three
hashes, and one of them equalled the previous build's hash — a false pass. The offense
MULTISET was identical every time; only the serialization order moved (`DeprecatedFilter`
and `LiquidHTMLSyntaxError` blocks swap). **Use `sort | sha256sum`.** Also: discard the first
timed run (the first baseline sat 9 % above the warm median and nearly produced a false
"9 % faster" claim), and do not read RSS at this precision (57 % spread across five runs of
one build, against ~2 % for CPU).

Related: cross-package specs resolve through `main: dist/index.js`, so sabotaging
`platformos-common/src` proves nothing until the package is rebuilt.

## Landed in this branch

- `workspace-dependencies.spec.ts` — dependency-cycle guard over the runtime graph, naming
  the whole cycle. Sabotage-verified. (AC #6)
- `package-boundaries.spec.ts` — dependency list unchanged; the RATIONALE rewritten to record
  the measurement, so the next person meets it instead of re-running it. (AC #9)
- `AppFile.revision` + `App.spec.ts` assertions; `revisionOf` through `ShapeAnalyzerDeps` and
  both consumers; `shape-analysis.revision.spec.ts`. (spike 2)
- `shape-analysis.spec.ts` — a content-staleness test for the partial-analysis memo. There was
  none: the two committed tests hold a partial whose source never changes, so both passed with
  the whole revalidation deleted.

`yarn build` clean, `yarn test` 3880/3880, vscode web extension and CodeMirror playground both
build.

## Follow-ups the research found (not done here, listed in doc-1 with their verification)

1. `DocumentsLocator.expandedPathsCache` **goes stale** — a theme directory appearing after the
   first expansion is invisible until `app/config.yml` changes, which is its only invalidation
   point. Probed.
2. `nested-graphql-query` is the one check that never consults the App — own `fs.readFile` AND
   own parse.
3. `backfill-docs` holds an `app` (`index.ts:67`) and still reads and parses files itself.
4. `shape-analysis.ts:922` cites `clearUndefinedVariablesCache`, deleted 2026-08-09; and
   `clearShapeAnalysisCaches` has no caller in the monorepo.
5. Typing `AppFile.ast` deserves its own task — it needs jsonc and yaml moved down too, and
   this research shows it buys no correctness.

## Those follow-ups are now DONE (2026-08-11) — steps 2-5 of doc-1's migration table

Step 1 (`AppFile.revision` + `revisionOf`) had already landed. The rest, each verified the way
doc-1 asked for:

**Step 2 — `expandedPathsCache` staleness. FIXED, and it needed TWO invalidations, not one.**
Clearing the expansion cache alone would have been decorative: `CachedFileSystem.readDirectory`
is keyed per URI and the watcher invalidated only `dirname(createdFile)`, so writing
`theme/v2/card.liquid` dropped the listing of `theme/v2` and left `theme/` — the directory the
expansion actually lists — cached. `startServer.ts` now drops the whole ancestor chain on
Created/Deleted (a `Map.delete` miss costs nothing, so it walks to the scheme root and needs no
project root to stop at) AND clears the expanded paths. Reproduced end to end in
`server/startServer.spec.ts`: go-to-definition on `{% theme_render_rc 'card' %}` answered `null`
after the theme was replaced. Sabotage-verified in both directions — reverting the handler fails
the LSP test, emptying `clearExpandedPathsCache` fails it and the locator probe.

Also: doc-1's probe is now a test, and it replaced a VACUOUS one. `DocumentsLocator.spec.ts`'s
'should clear expanded paths cache' asserted only that clearing left the answer unchanged on an
UNCHANGED tree — it passes with the method reduced to an empty body. It now records all three
answers (fresh → stale → recovered). Its mock filesystem snapshotted the file set at
construction, so no staleness test could have been written against it at all; it derives the
tree per call now.

**Step 3 — `NestedGraphQLQuery` reads through the App.** `containsGraphQLTransitively` took a
bare `{ readFile }`; it now takes a `readPartialAst` closure that tries `context.app.get(uri)`
→ `load()` → `ast` (guarded by `isLiquidDocument`, the same shape `UnknownProperty.readPartial`
uses) and keeps the `fs` fallback for a URI outside the walked subtrees. Verified by extending
`index.spec.ts`'s parse-once family with a Liquid case, using the same marker discipline: the
counting parser REWRITES a marker into `{% graphql %}`, so the offense can only appear if the
check read the app's AST. Bypassing the app yields zero offenses — the test proves WHICH parse
was used, not just how many happened, and also pins one parse for two call sites.

**Step 4 — `backfill-docs` reads through the app it already holds**, and `getUsedVariables` now
takes that AST instead of re-parsing. Its `DocumentsLocator` also gets the app, so resolution
uses the index. The command had specs for each of its three helpers and NONE for itself; it now
has one — what it writes, plus a case where the app carries an unsaved buffer and that content
is what gets documented, which is the observable that distinguishes the two implementations
(counting reads cannot: the old read went straight to `node:fs/promises`). Sabotage-verified.

**Step 5 — already resolved.** Neither `clearShapeAnalysisCaches` nor the
`clearUndefinedVariablesCache` citation exists anywhere in the tree or on master; a later commit
removed both. Nothing to correct.

**The larger decision doc-1 deliberately deferred — typing `AppFile.ast` — is now TASK-77**,
carrying the measured numbers so the reverted spike is not re-run.

Changeset: `.changeset/read-through-the-app-and-drop-stale-listings.md`. Every package suite
green; build, type-check and format:check clean.
<!-- SECTION:NOTES:END -->
