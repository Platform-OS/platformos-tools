---
id: doc-1
title: 'TASK-74: Should platformos-common own project state — the answer, measured'
type: other
created_date: '2026-08-09 19:00'
updated_date: '2026-08-09 19:03'
---
# Should `platformos-common` own project state? — the answer, measured

Research for TASK-74, 2026-08-09, against `improve-shape-analysis` @ `6d89b4f`.

## Decision: MOVE IN PART — and NOT the part the task expected

The task asks one question that turns out to be three, and they have different answers.

| Question | Answer | Why |
|---|---|---|
| Should `platformos-common` take `@platformos/liquid-html-parser`? | **No** — not for this | Costs ~nothing (measured), buys nothing for the stated goal. Its only real payoff is typing `AppFile.ast`, which is **not a one-package move** |
| Should the derived-metadata caches move onto `AppFile`? | **One of 22**, and it could not move as-is | 18 have a named blocking reason; 4 are already there. The one that wanted it has **transitive** dependencies, which `derived` does not model |
| Can invalidation become one story without moving anything? | **Yes — do this** | `AppFile.revision` + `revisionOf`. Measured: 25 414 revalidating file reads per whole-project run become integer comparisons, `byContent: 0` |

**The premise that the parser dependency is what stands in the way is wrong**, and this is the single most useful correction in this document. `AppFile.derived` already works with `ast: unknown` — `undefinedVariablesOf` is the worked proof, and deleting `setSource`'s `derivedValues = undefined` fails its spec (sabotage-verified, after rebuilding the package: see *Cross-package specs test `dist`* below). And every check that "bypasses the App" bypasses it by **not looking the file up** (`app.get` / `findOrLocate`), not because parsers are injected. Both outcomes the task wants are reachable without changing a single dependency.

---

## What was measured

### Spike 1 — `platformos-common` takes the parser

Five mechanical edits, reverted after measuring: add `@platformos/liquid-html-parser` to `platformos-common/package.json`; `git mv` `checks/partial-call-arguments/extract-undefined-variables.ts` to `platformos-common/src/app/undefined-variables.ts` and point its `AppFile` import at `./AppFile`; export it from `app/index.ts`; leave a re-export at the old path; add the dependency to `package-boundaries.spec.ts`'s exact list.

- **Builds**: `yarn build` clean. `package-boundaries.spec.ts` + `workspace-dependencies.spec.ts` pass.
- **No cycle**: `liquid-html-parser` has **no workspace dependencies** (`line-column`, `ohm-js`), so this edge cannot close a loop. Browser-safe: both are.
- **Bundle**: `+881 bytes` on `dist/browser/extension.js` (9 009 542 → 9 010 423), **+0.010 %**. Because the parser was already in the bundle — check-common depends on it — so the delta is only the moved module shifting.
- **CPU**: no measurable change. project-b warm: HEAD 16.43–17.60 s, spike 17.34–17.70 s.
- **Offenses**: multiset identical on all four corpus projects.

**Verdict: cheap and pointless.** Nothing in the goal depends on it. The one thing it would buy — a typed `AppFile.ast` — needs the YAML/JSON AST too, and `JSONNode` lives in check-common (`src/jsonc/types.ts`); YAML parses into that same node. So `ast` cannot be typed by moving one package.

### Spike 2 — invalidation by revision, no dependency change (in the working tree)

`AppFile.revision`: a **process-wide** logical content clock, moved by `setSource` and `invalidate` and by nothing else. `ShapeAnalyzerDeps.revisionOf?(uri)` hands it to the partial-analysis memo, whose recorded reads become `{revision}` instead of `{content}`.

Process-wide rather than per-file because `App.update` **replaces** the file object: a per-file counter restarts at zero on the replacement, so a recording made against the old file would compare equal to a brand-new one and be trusted. Sabotaged into a per-file counter, `App.spec.ts`'s `never gives a replaced file the revision the one it replaced had` fails.

Measured on the corpus, whole-project lint:

| | revalidation hits | reads re-read | bytes compared | via revision | via content |
|---|---|---|---|---|---|
| project-a, HEAD | 8 279 | 26 666 | 25 479 084 | — | 26 666 |
| project-a, spike 2 | 8 173 | 0 | 0 | 25 414 | **0** |
| project-c, HEAD | 5 223 | 16 126 | 13 981 098 | — | 16 126 |
| project-c, spike 2 | 5 173 | 0 | 0 | 16 033 | **0** |
| project-b | 0 | 0 | 0 | 0 | 0 |

- **Offenses**: multiset identical on all four.
- **CPU**: unchanged. project-a warm — HEAD 64.12 / 64.15 / 65.69 s, spike 2 64.40 s.
- **Bundle**: `+3 500 bytes` on `dist/browser/extension.js`, **+0.039 %**.
- project-b is the **control**: it never enters the analyzer at all, so any change to this cache must show exactly zero there, and does.

**The performance ceiling was measured before the work, not after.** Replacing `isStale` with `return false` — unsound, and therefore an upper bound on what any revalidation change can win — gives project-a 62.50 / 63.59 / 63.67 s against HEAD's 64.12 / 64.15 / 65.69: **1–2 %, with the bands nearly touching.** So spike 2 must be justified on correctness, and is:

> The rule it replaces is a **comment** — "`readContent` MUST read from the same place `readPartial` and `readGraphQL` do" — and it had already been broken once, by a memo that revalidated from disk while the analysis read the open editor buffer. A revision is compared, never read. There is no second read path left to disagree.

---

## Three findings about the METHOD, which outlast this task

### 1. The corpus oracle, as practised, is invalid

"Whole-project offenses byte-identical" is gated by hashing the CLI's report. **That report is not byte-stable across runs of the same build.** Three runs of project-b on one build produced three hashes — and one of them was exactly the *previous build's* hash, which would have read as a clean pass:

```
run1 b21fda0d649e3238   run2 b21fda0d649e3238   run3 e9ad259ef40fdc3c
```

The offense **multiset** was identical every time; only the serialization order moved (blocks of `DeprecatedFilter` and `LiquidHTMLSyntaxError` swap position). Two of four projects showed it. It produces both false alarms and — as run 3 shows — false passes.

**Use `sort | sha256sum`, not `sha256sum`.** Every comparison in this document does.

### 2. Discard the first timed run; ignore RSS at this precision

The first baseline (project-b, 19.13 s) sat 9 % above the warm median (17.47 s, band 16.43–17.60) and nearly led to a claim that spike 1 was 9 % faster. Five runs on one build:

- **CPU** spread ≈ 2 % — usable.
- **RSS** spread 693 860 – 1 091 804 KB, **57 %** — not a signal. Reported RSS numbers in this repo's task records should be read with that in mind.

### 3. Cross-package specs exercise `dist`, not `src`

Every workspace package resolves through `main: dist/index.js`. Sabotaging `platformos-common/src` changed no sibling spec's result until the package was rebuilt — the first sabotage of `AppFile.derived` came back green and looked like a missing test. Rebuild the dependency before concluding anything from a sibling package's suite.

---

## Inventory: every parse and every derived-metadata cache

Verified against the code, not memory. Every one was **probed** — the input was changed and the answer watched — either by a probe written for this research or by a committed spec that already does exactly that (`extract-undefined-variables.cache.spec.ts` for #1-2, `deprecated-tag/index.spec.ts` for #5, `shared-app.spec.ts` for #19). The probes worth keeping are landed as specs; the rest were throwaway, and the one that found a defect is reproduced below.

| # | Cache | Key | Freshness rule | Bound | Consumers | Can common own it? |
|---|---|---|---|---|---|---|
| 1 | `AppFile.parsed` (`ast`) `AppFile.ts:222` | none, one per file object | dropped by `setSource`/`invalidate`; `App.update` replaces the object | App's file set; check-node evicts at 200 by `lastTouch` | every check, the LSP, the graph | already |
| 2 | `AppFile.derivedValues` `AppFile.ts:249` | caller string; must carry all non-file inputs | same two lines as the parse | as above | `undefinedVariablesOf` — the only one | already |
| 3 | `analysisCache` `shape-analysis.ts:817` | `uri ∥ bindings ∥ analysisIdentity ∥ external-shapes? ∥ schemaId` | records reads **transitively**; every hit revalidates | LRU 512 | `UnknownProperty`, LSP `TypeSystem` | **no: transitive deps** |
| 4 | `schemaIds` `shape-analysis.ts:902` | the SDL string | never; ids from a counter | unbounded in distinct SDLs (~304 KB each) | #3's key, nothing else | no: docset input |
| 5 | `probeCache` `deprecated-tag/index.ts:142` | `replacement ∥ isBlock ∥ markup` | content-keyed — cannot go stale | LRU 256 | `DeprecatedTag` | no: no file (synthesised probe) |
| 6 | `schemaCache` `graphql-schema.ts:23` | the SDL | content-keyed | LRU 1 | `GraphQLCheck`, `inferShapeFromGraphQL` | no: docset + `graphql` module identity |
| 7 | `inScopeNamesByObjects` `in-scope-names.ts:20` | WeakMap on `objects()` array, then file type | new array ⇒ new entry | weak | `PartialCallArguments`, `target-params` | no: docset input |
| 8 | `matchersByConfig` `ignore.ts:20` | WeakMap on `Config`, then check code | config-object identity; in-place mutation NOT seen | weak | `isIgnored`/`hasIgnorePatterns` — `check()` and check-node's path walk | no: `Config` is check-common's |
| 9 | `ModuleCache` `graph/module.ts:30` | WeakMap on `AppGraph`, then URI | graph lifetime; holds no source | weak | `getModule`, i.e. every traversal | no: graph identity |
| 10 | `getSourceCode` memo `graph/augment.ts:15` | URI | one traversal — a build sees one snapshot | per build | the graph build | no: per-build by design |
| 11 | `CachedFileSystem` | URI × 3 caches (`readFile`/`readDirectory`/`stat`) | watcher `invalidate(uri)`; `app/config.yml` bypasses | unbounded/session | the whole language server | no: `readDirectory`/`stat` aren't contents |
| 12 | `DocumentManager.views` `:99` | WeakMap on the `AppFile` object | object lifetime; inner `getLiquidDoc` re-computes on source change | weak | every LSP feature, via `get`/`app` | no: holds `TextDocument` |
| 13 | `TypeSystem` `graphqlDocuments`/`partials` `:1542` | name | ONE symbols-table build | per build | the shape analyzer deps for that build | no: per-request by design |
| 14 | `TypeSystem` `memo`s `:147-227` | none, one per `TypeSystem` | instance lifetime | one each | completions, hover, diagnostics | no: docset input |
| 15 | `SearchPathsLoader.cache` | root URI | explicit `invalidate()` on config.yml | one/root | document links, definitions, checks | no: LSP lifecycle |
| 16 | `DocumentsLocator.expandedPathsCache` `:288` | `rootUri ∥ searchPath` | `clearExpandedPathsCache()`, **only** on config.yml | unbounded/locator | `locateWithSearchPaths` (`theme_render_rc`) | already — **and it goes stale, below** |
| 17 | `TranslationProvider.translationsCache` `:25` | `baseUri:locale` | explicit `clearTranslationsCache(uri?)` | unbounded/provider | translation checks, LSP translation features | already |
| 18 | `RouteTable.routes` `:186` | page URI | `updateFile`/`removeFile`/`build` | project pages | `MissingPage`, LSP page-route definitions | already |
| 19 | `getSharedApp` fingerprints | URI → `mtime:size` | walk reconciles; `stat` per in-memory file; buffers exempt | 200, by `lastTouch` | check-node CLI, MCP supervisor | no: Node-only `stat` |
| 20 | `AugmentedPlatformOSDocset` memos | none, one per instance | instance (one per run) | one each | every check | no: docset input |
| 21 | `DocumentManager.preload` `:243` | root URI | never — once per root per session | one/root | LSP startup | no: LSP lifecycle |
| 22 | `loadConfig`/`findProjectRoot` `startServer.ts:111` | URI | `clearCache()` on `.platformos-check.yml` | unbounded/session | the language server | no: config is check-common's |

**Blocking reasons, tallied:** docset input 5 · non-file identity 6 · per-build or per-request scope *by design* 4 · Node-only 1 · LSP/config lifecycle 2 · already in `platformos-common` 4.

### Why #3 could not simply move onto `AppFile.derived`

`runPartialAnalysis` merges its callee's reads into its own (`shape-analysis.ts:518`), so an entry depends on a **transitive closure** of files. `derived` is dropped by the owning file's `setSource`/`invalidate` and by nothing else, so hanging a transitive analysis on the caller's file would leave it stale when a nested partial changed. That is the gap `revision` fills: the entry names its dependencies and their revisions, rather than being owned by any one file.

---

## Real defects found by probing (none of these were known)

1. **`DocumentsLocator.expandedPathsCache` goes stale.** It caches the subdirectories a dynamic search-path segment expanded to. Its only invalidation point is `startServer.ts:631`, on a change to `app/config.yml` — and **a new theme directory does not change `app/config.yml`.** A new theme's partials therefore do not resolve until the config file is touched or the server restarts. The probe:

```ts
const files = { 'app/views/partials/theme/v1/card.liquid': 'v1' };
const locator = new DocumentsLocator(new MockFileSystem(files, ROOT));
const before = await locator.locateWithSearchPaths(root, 'card', ['theme/{{ version }}']);
files['app/views/partials/theme/v2/card.liquid'] = 'v2';
delete files['app/views/partials/theme/v1/card.liquid'];
const afterNewDirectory = await locator.locateWithSearchPaths(root, 'card', ['theme/{{ version }}']);
locator.clearExpandedPathsCache();
const afterClearing = await locator.locateWithSearchPaths(root, 'card', ['theme/{{ version }}']);
// before            → …/theme/v1/card.liquid
// afterNewDirectory → undefined          <-- the defect
// afterClearing     → …/theme/v2/card.liquid
```
2. **A comment cites a function deleted the same day.** `shape-analysis.ts:922` justifies `clearShapeAnalysisCaches` as "the same shape as `clearUndefinedVariablesCache`, which its sibling cache exports for the same reason" — that memo moved onto `AppFile` on 2026-08-09 and the function is gone. And **`clearShapeAnalysisCaches` itself has no caller anywhere in the monorepo.**
3. **`matchersByConfig` is invisible to in-place mutation.** Correct given the "a `Config` is immutable for the life of a run" contract, and now pinned rather than assumed.
4. **`CachedFileSystem` serves a stale `readFile` by design** until the watcher fires — which is why `app/config.yml` is exempted. Both halves probed, so neither is folklore.

---

## `toLiquidHtmlAST(` outside the parser package — all 12 sites (AC #10)

Classified per site. **They are not one class**, and a rule that deleted them all would delete four that are correct.

**Parses a project file, and the App can own it — move:**
- `checks/nested-graphql-query/index.ts:79` — the only site that **never consults the App at all**: `containsGraphQLTransitively` takes a bare `{ readFile }`, reads the located partial itself (`:72`) and parses it itself.
- `check-node/backfill-docs/index.ts:24` and `doc-updater.ts:30` — this CLI **already holds an `app`** (`index.ts:67`) and still reads with `fs.readFile` (`:113`) and parses twice.

**Parses a project file, App tried first — correct fallback, keep:**
- `checks/unknown-property/index.ts:90` — `readPartial` tries `context.app.get(uri)` at `:79`. `findOrLocate` can answer with a URI outside the walked subtrees, which has no `AppFile` by definition.
- `language-server-common/TypeSystem.ts:1646` — same shape in `readLiquidFile`, App path at `:1634`.

**Not a project file — keep; a rule that removes these is wrong:**
- `checks/deprecated-tag/index.ts:151` — a synthesised one-tag probe string. No file exists.
- `checks/valid-html-translation/index.ts:31` — an HTML fragment inside a YAML translation *value*.
- `completions/params/LiquidCompletionParams.ts:112` — buffer text with a placeholder inserted at the cursor.
- `formatting/…/HtmlElementAutoclosingOnTypeFormattingProvider.ts:96` — buffer text with autoclosing already applied.
- `checks/…/extract-undefined-variables.ts:127` — the documented escape hatch for a source with no file behind it.
- `prettier-plugin-liquid/src/parser.ts:6` — Prettier's parser entry point; this package has no `App`.

**The App's own parse:**
- `check-common/to-source-code.ts:20` — the parser injected into `App`. This is the one that should exist.

## `fs.readFile` of a project file outside the App (AC #11)

| Site | Consults the App first? |
|---|---|
| `checks/nested-graphql-query/index.ts:72` | **no** — the one real offender |
| `check-node/backfill-docs/index.ts:113` | **no**, though it holds an `app` |
| `checks/unknown-property/index.ts:64` | yes (`readContent`) |
| `checks/graphql-variables/index.ts:46` | yes, documented at `:34` |
| `liquid-doc/target-params.ts:69` | yes, at `:63` |

---

## The other acceptance criteria

**Browser builds (AC #4).** vscode web extension builds under both spikes; CodeMirror playground (`tsc -b playground/tsconfig.json`) builds. Deltas on `dist/browser/extension.js`: spike 1 **+881 B (+0.010 %)**, spike 2 **+3 500 B (+0.039 %)**. `platformos-common` still imports nothing from Node.

**One set of file objects (AC #5).** Survives, and neither spike touches the mechanism. `Parsers` injection is unchanged; `graphParsers` still registers `.js`/image parsers onto the same `App`; `appBackedGetSourceCode` still hands the graph the very `AppFile`s the lint holds. Pinned by `platformos-graph/src/parsers.spec.ts` and `language-server-common/src/documents/app-adapter.spec.ts`, both green. Spike 2 strengthens the property: `revisionOf` gives the linter's analyzer and the editor's the *same* number from the *same* `App`.

**No cycle (AC #6).** Added to `workspace-dependencies.spec.ts`: builds the runtime (`dependencies`) graph and fails naming the whole cycle. Sabotage-verified — adding `@platformos/platformos-check-common` to `platformos-common` produces
`@platformos/platformos-check-common -> @platformos/platformos-common -> @platformos/platformos-check-common`.
Runtime deps only, deliberately: a devDependency is a sibling borrowed for a test (`platformos-graph/src/graph/test-helpers.ts` imports `platformos-check-node`) and a monorepo may legitimately grow a cycle in those. Measured 2026-08-09: acyclic under **both** readings, so the narrower rule hides nothing today.

**`package-boundaries.spec.ts` (AC #9).** **Dependency list left intact; the rationale updated in the file itself**, because the reason a rule holds belongs where the rule is, not only in a research note. Its old rationale was browser-safety plus "the model stops being shareable the moment it depends on something above it". The browser-safety half is now *measured* rather than assumed (+0.010 %, and `liquid-html-parser` has no workspace deps of its own), so it is no longer the reason. The reason that survives is narrower and stronger, and is now written into the spec: **`ast: unknown` is not a limitation being worked around — it is the evidence that the design does not need the parser.** `derived` already carries analyses this package cannot name. The comment also records that opening the list should be for a typed `ast`, which needs jsonc and yaml moved down too, so the next person meets the measurement instead of re-running it.

---

## Migration, in independently deliverable steps (AC #8)

Each is separately reviewable and separately verifiable. **1 is independent; 2–4 are independent of each other; 5 depends on 1.**

| # | Step | Verified by | Size |
|---|---|---|---|
| 1 | **Land `AppFile.revision` + `revisionOf`** (spike 2, in the working tree) | `App.spec.ts` revision block, `shape-analysis.revision.spec.ts`, corpus multiset | ~90 lines, 5 files |
| 2 | **Fix `expandedPathsCache` staleness** — invalidate on a created/deleted directory under a partial root, or drop the cache and measure what it was worth | the probe above, plus a control that an unchanged tree still hits | small |
| 3 | **`nested-graphql-query` reads through the App** — take `context.app`, `app.get(uri)?.ast` before `fs.readFile` + `toLiquidHtmlAST` | corpus multiset identical; parse count on a project with a `{% graphql %}` chain | small |
| 4 | **`backfill-docs` reads through the app it already has** | its own spec; multiset of rewritten files unchanged | small |
| 5 | **Correct the two stale comments** — `shape-analysis.ts:922`, and delete `clearShapeAnalysisCaches` if step 1 leaves it callerless | build | trivial |
| — | **Do NOT** add `liquid-html-parser` to `platformos-common` | — | — |
| — | **Do NOT** move `analysisCache` onto `AppFile.derived` | — | — |

A separate, larger decision, deliberately not folded in: **typing `AppFile.ast`.** It needs `JSONNode` (jsonc + yaml) moved into `platformos-common` as well as the Liquid parser. Worth its own task, and worth deciding on ergonomics, since this research shows it buys no correctness.

**One thing to fix first, because it gates every "offenses unchanged" claim this repo makes:** the corpus comparison must sort before hashing. Until it does, a real regression can pass and an innocent change can fail.
