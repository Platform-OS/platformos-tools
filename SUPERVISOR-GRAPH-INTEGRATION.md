# Supervisor ⇄ Graph Integration

Branch: `supervisor-graph-integration`

This document is the PR-style summary **and** the architectural reference for the
work that makes `platformos-graph` the project structural/dependency model and
wires it into the MCP supervisor's `validate_code`. It covers what shipped, the
decisions (with ADR links), the full graph feature surface, worked output
examples, and the open doubts.

> **§8 is the code-review remediation** — a high-effort review of the whole branch
> ran before submission (8 finder angles + verification), surfacing 11 findings.
> Ten were fixed and one deferred with rationale; that section is the place to
> understand _what changed as a result of review and why_. The rest of this
> document reflects the **post-review** state.

---

## 1. PR summary

### What & why

The rebuilt `platformos-mcp-supervisor` must tell coding agents not just _what is
wrong_ in a file but _how the file sits in the project_ — what it renders/calls,
what it wraps, where targets resolve, and the file's own structure. The
architectural rule (ADR 003): **all graph/structure logic lives in
`platformos-graph`; the supervisor is a pure consumer.** This branch extends the
graph to provide that model and consumes it from `validate_code`.

### Highlights

- **Dependency edges** for every static Liquid construct — `render`, `include`,
  `function`, `background`, `graphql`, asset filters, and frontmatter `layout`
  — each carrying a semantic `kind`, call-site range, and named-arg names.
- **Per-file primitive** `extractFileReferences` — resolves one in-flight buffer's
  outgoing edges without building the whole graph (the buffer-before-write model).
- **`validate_code` returns `impact`** _(TASK-9.10 — see §9)_ — the cross-file
  **blast radius**: who depends on the edited file (its callers), plus
  **signature-impact** (callers whose args no longer match the file's `{% doc %}`).
  This is the one graph signal lint cannot produce; the earlier per-file
  `dependencies`/`structural` fields were **removed** as redundant with lint
  (`MissingPartial`/`MissingAsset` + `PartialCallArguments`) — see §9.
- **Never-stale cached graph** _(TASK-9.10)_ — a fingerprint-validated
  `GraphCache` at the supervisor edge: reused across calls, background-built, and
  **never served stale** (a changed project reports `computing`, never a wrong
  answer).
- **Project-structure query API** — dependents / orphans / reachability /
  missing-target / nearest-name ("did you mean").
- **Per-file self-structural** — `renders_used`, `graphql_queries_used`,
  `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`,
  `layout`, `method`, exposed both as the per-file primitive `extractStructural`
  _(exported in review — §8/F1)_ and, opt-in, on each module during a full build.
- **Platform facts** — a GraphQL op's `table`, schema/`CustomModelType` nodes.
- **`'layout'` DocumentType** in `DocumentsLocator` (the canonical resolver),
  with `.html.liquid`/`.liquid` precedence.
- **Two ADRs**: 003 (graph-backed enrichment) resolved; **004** (the
  platform-fact-vs-convention boundary — why commands/queries do **not** belong
  in the graph).

### Scope discipline (kept the changes safe)

- **Additive everywhere.** New optional fields (`Reference.kind`, `.args`,
  `GraphQLModule.table`, `LiquidModule.structural`, `SchemaModule`), new query
  functions, new DocumentType. No breaking change to existing consumers.
- **The LSP output is unchanged.** The `validate_code` output was reshaped by
  TASK-9.10 (§9): `dependencies`/`structural` removed, `impact` added — a
  deliberate change to a not-yet-released tool, verified by whole-result
  assertions.
- Cross-package safety re-verified after every slice: graph, check-common,
  check-node, language-server, supervisor.

### Verification (final, post-review)

| Package                           | Tests    | Δ from pre-review                                       |
| --------------------------------- | -------- | ------------------------------------------------------- |
| platformos-common                 | **257**  | +12 (`effectivePageSlug`)                               |
| platformos-graph                  | **80**   | +7 (structural opt-in/primitive, node-identity)         |
| platformos-check-common           | **1057** | +10 (`extractSchemaTable`)                              |
| platformos-mcp-supervisor         | **55**   | 9.10: +graph-cache (7) +impact (10), −structure adapter |
| platformos-language-server-common | **467**  | unchanged                                               |

All packages type-check clean (via **direct `tsc --noEmit`** — see §8/F6 note on
the flaky `yarn workspace type-check` wrapper); `yarn format:check` clean;
`--frozen-lockfile` clean with **zero `yarn.lock` churn** (no new deps). The
**only** red anywhere is a pre-existing, local-only timeout in `TypeSystem.spec`
(a heavy LSP type-inference test that exceeds 5s only under full-suite parallel
load on a contended machine — confirmed passing at ~3.1s in isolation; proven
unrelated by a stash baseline; CI does not hit it).

> **Working-tree note:** the graph/supervisor feature slices are committed on the
> branch. The **code-review remediation (§8)** — spanning common, check-common,
> graph, and supervisor — is currently **in the working tree, not yet committed**;
> the rebuilt `dist/` outputs for common, check-common, and graph are regenerated
> and also uncommitted. Commit both before opening the PR.

---

## 2. Architecture

### 2.1 Package responsibilities (the separation we hold)

```
liquid-html-parser     CST → AST (the parse everything reuses)
platformos-common      path/URI math, DocumentsLocator (resolution), RouteTable/slug,
                         frontmatter schemas, AbstractFileSystem
platformos-check-common lint engine, Offense, ReferenceKind/Reference, getPosition,
                         levenshtein, liquid-doc, graphql parsing, extractGraphqlTable
platformos-check-node   NodeFileSystem, lintBuffer / check()
platformos-graph        THE project model: AppGraph (nodes + edges), buildAppGraph,
                         extractFileReferences, query API, self-structural
platformos-language-server-common  LSP — consumes the graph (references/dependencies/dead_code)
platformos-mcp-supervisor          validate_code — pure consumer of graph + check engine
```

Rule of thumb that governs every decision here:

- **Parsing/resolution/path facts** → owned by common/check-common, **reused** by
  the graph (never re-derived).
- **The project model (nodes, edges, queries, self-structural)** → owned by
  `platformos-graph`.
- **Agent ergonomics (the `validate_code` shape, prose, gating)** → owned by the
  supervisor, which contains **zero** graph/scanner logic.

### 2.2 The graph model

```ts
AppGraph {
  rootUri: string
  entryPoints: AppModule[]              // pages + layouts (render roots)
  modules: Record<uri, AppModule>       // every reachable node + standalone schema nodes
}

AppModule = LiquidModule | AssetModule | GraphQLModule | SchemaModule
  IAppModule {
    type, uri,
    dependencies: Reference[]           // outgoing edges
    references:   Reference[]           // incoming edges
    exists?: boolean
  }
  LiquidModule  { kind: Page|Partial|Layout, structural?: ModuleStructural }
  AssetModule   { kind: 'unused' }
  GraphQLModule { kind: 'graphql', table?: string }
  SchemaModule  { kind: 'schema',  table?: string }   // custom_model_type

Reference {
  source: { uri, range? }               // call site (0-based offsets)
  target: { uri }                       // DocumentsLocator-canonical, normalized
  type: 'direct' | 'indirect'
  kind?: 'render'|'include'|'function'|'background'|'graphql'|'asset'|'layout'
  args?: string[]                       // named-argument names at the call site
}

ModuleStructural {
  renders_used, graphql_queries_used, filters_used, tags_used,
  translation_keys, doc_params: string[]   // always present (empty = none)
  slug?, layout?, method?: string          // page routing facts (absent = N/A)
}
```

### 2.3 Two resolution paths, one shared resolver

`resolveLiquidReferences` (internal) is the **single** place that maps a Liquid
construct → resolved target + kind + args. Both callers go through it, so the two
paths can never drift:

1. **`buildAppGraph(rootUri, deps, entryPoints?, options?)`** — full project graph
   from disk. Entry points default to pages + layouts; traversal follows edges; a
   full build additionally discovers standalone **schema** nodes. Populates
   incoming `references`, `exists`, and `table`. `structural` is populated **only
   when `options.includeStructural` is set** (default off — see §8/F1); the LSP,
   the sole full-build caller, does not read it and so does not pay for it.
2. **`extractFileReferences(rootUri, sourceUri, sourceCode, { fs })`** — one
   file's **outgoing** edges from an **in-flight buffer** (parsed by the caller,
   may not be on disk). No whole-graph build, no reachability requirement.
3. **`extractStructural(sourceCode, uri)`** _(exported in review — §8/F1)_ — the
   per-file **self-structural** primitive (sibling to `extractFileReferences`):
   one buffer's own declarations, no build. `validate_code` uses paths 2 + 3 over
   a single shared parse.

### 2.4 Resolution is delegated to `DocumentsLocator`

The graph never hand-rolls path logic. Targets resolve through check-common's
`DocumentsLocator`, which owns lib search paths, `modules/<m>/public/...`
prefixes, and extension handling. This branch added a **`'layout'` DocumentType**
there (maps to `PlatformOSFileType.Layout`, tries `.html.liquid` then `.liquid`),
so layout resolution + missing-target fallback come "for free", consistent with
every other reference kind.

---

## 3. Decisions (and why)

### ADR 004 — Platform facts vs. conventions (the load-bearing one)

`commands` and `queries` are **not** platformOS primitives — they're a convention
of the `core` module (`lib/commands/*`, `lib/queries/*` invoked by `{% function %}`).
The platform sees only "a `function` edge to a partial." Therefore:

- **The graph stays convention-free.** It models the `function` edge and the
  partial; it does **not** learn "command" vs "query". (Baking that in would make
  the platform model — and the LSP that depends on it — wrong for any app not
  using `core`.)
- **Resource/CRUD completeness** (the old `detectResources`) is split: neutral
  **platform facts** (schema tables, graphql `table`, slug) live in the graph
  (TASK-9.6, done); the **commands/queries convention overlay** lives outside it
  (TASK-9.7, deferred) — a descriptive map in the supervisor domain layer and/or
  a _configurable_ check (disable-able for non-`core` apps).

### ADR 003 — resolved

- **Self-structural owner = `platformos-graph`** (it already parses every file;
  exposes the snapshot as a by-product, composing check-common parsers).
- **`Reference.kind`/`args`** = optional additive discriminant + arg names.
- web-component (Shopify-era `<custom-element>`) machinery **removed** entirely —
  platformOS doesn't use `customElements.define`.

### Other notable decisions

- **`structural` usage arrays are always present** (empty = "none used"), so a
  consumer never has to disambiguate "absent" from "none". Routing facts
  (`slug`/`layout`/`method`) stay optional (absent = not applicable).
- **Orphan detection guards non-render node kinds.** A schema file has no incoming
  _edges_ (it's referenced by table name), so `isOrphan` explicitly excludes
  `Schema` to avoid a false "dead code" flag.
- **Schema discovery only on full builds.** Scoped/LSP builds (explicit
  `entryPoints`) are byte-unchanged.
- **`structural` / `table` are not serialized** (`SerializableNode` is unchanged)
  — they're in-memory facts for the query/overlay layer, not the CLI graph dump.
- **Edge tests assert edge identity only** (`structural` stripped via
  `edgeIdentity`) — separation of concerns; structural is pinned in its own spec,
  so edge tests stay stable as structural grows.

---

## 4. Graph feature surface (public API)

From `@platformos/platformos-graph`:

| Export                                                          | Purpose                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `buildAppGraph(rootUri, deps, entryPoints?, options?)`          | Build the full project graph from disk; `options.includeStructural` opts into per-module `structural` |
| `extractFileReferences(rootUri, sourceUri, sourceCode, { fs })` | One buffer's outgoing edges (no full build)                                                           |
| `extractStructural(sourceCode, uri)`                            | One buffer's self-structural (no build); `undefined` for non-Liquid/unparseable                       |
| `serializeAppGraph(graph)`                                      | JSON `{ rootUri, nodes, edges }`                                                                      |
| `toSourceCode(uri, source)`                                     | Parse a buffer into a `FileSourceCode`                                                                |
| `dependenciesOf(graph, uri)`                                    | Outgoing edges (what it renders/calls/wraps) — call sites w/ kind + args                              |
| `dependentsOf(graph, uri)`                                      | Incoming edges (who renders/calls it)                                                                 |
| `exists(graph, uri)`                                            | Does it resolve to a real file                                                                        |
| `isEntryPoint(graph, uri)`                                      | Is it a page/layout root                                                                              |
| `isOrphan(graph, uri)` / `orphans(graph)`                       | Unreferenced dead files (schema-guarded)                                                              |
| `reachableFrom(graph, uri)`                                     | Transitive outgoing closure                                                                           |
| `missingDependencies(graph, uri)` / `missingTargets(graph)`     | Unresolved edges                                                                                      |
| `nearestModules(graph, uri, { limit?, maxDistance? })`          | Same-category "did you mean" by edit distance                                                         |
| `ModuleStructural` / `GraphBuildOptions`                        | Self-structural shape; build options                                                                  |

There is also a CLI (`bin/platformos-graph`): `platformos-graph <root> [file]`.

### What `validate_code` discovers today

Per call (`{ file_path, content, mode }`):

- **Lint** (check-node `lintBuffer`): errors / warnings / infos with 1-based
  positions, `must_fix_before_write` gate, `status`. Lint is the **primary,
  forward-looking** signal — it also covers broken references (`MissingPartial`/
  `MissingAsset`) and argument correctness (`PartialCallArguments`).
- **`impact`** (graph `dependentsOf` over the cached graph — §9): the
  **backward, cross-file** signal lint cannot produce —
  - `dependents`: who references the edited file (`total`, `by_kind`, a capped
    `sample`), so the agent knows the blast radius before changing a shared file;
  - `signature_risk`: existing callers whose args no longer match the buffer's
    `{% doc %}` contract (the cross-file inverse of `PartialCallArguments`);
  - `status` (`computed`/`computing`/`unavailable`): never stale — "nothing
    depends on this" (computed, 0) is distinguishable from "not computed yet".

The earlier per-file `dependencies`/`structural` fields were **removed** (§9): a
buffer's own outgoing edges + self-summary duplicated lint and echoed what the
agent just wrote. The graph primitives (`extractFileReferences`/
`extractStructural`) remain for the CLI, serialization, and the planned
`project_map`/`validate_project` tools (TASK-9.11 / 9.12).

---

## 5. Worked examples (real output, not illustrative)

### 5.1 `validate_code` — a layout that omits `content_for_layout` while wiring deps

Input `app/views/layouts/application.liquid`:

```liquid
---
layout: theme
---
{% function nav = 'queries/list' %}
<html><body>{% render 'header', title: 'Hi' %}</body></html>
```

Output (verbatim):

```json
{
  "status": "error",
  "must_fix_before_write": true,
  "errors": [
    {
      "check": "MissingContentForLayout",
      "severity": "error",
      "message": "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
      "line": 1,
      "column": 1,
      "end_line": 1,
      "end_column": 1
    }
  ],
  "warnings": [],
  "infos": [],
  "proposed_fixes": [],
  "clusters": [],
  "scorecard": [],
  "impact": {
    "scope": "direct",
    "status": "computed",
    "dependents": {
      "total": 2,
      "by_kind": { "layout": 2 },
      "sample": ["app/views/pages/about.liquid", "app/views/pages/index.liquid"]
    }
  },
  "parse_error": null,
  "tips": [],
  "domain_guide": null
}
```

Two signals coexist without conflation:

- the **lint error** (`MissingContentForLayout`) — the per-file, forward-looking
  gate;
- the **blast radius** (`impact`) — the cross-file signal lint cannot give: **2
  pages use this layout**, so the missing `content_for_layout` affects both. The
  agent sees who is impacted before writing. (`status: computed` with `total: 0`
  would instead mean "nothing depends on this — safe to change".)

The buffer's own outgoing edges are covered by lint (`MissingPartial` /
`PartialCallArguments`), so the previously-shown `dependencies`/`structural`
fields were removed as redundant — see §9. For a **partial** edit whose `{% doc %}`
changed, `impact.signature_risk` additionally lists the callers whose arguments no
longer match.

### 5.2 Graph self-structural — `header.liquid`

For

```liquid
{% doc %}
  @param title [String] heading
{% enddoc %}
<header>{{ title | upcase }}</header>
```

`graph.modules[…/header.liquid].structural` is:

```json
{
  "renders_used": [],
  "graphql_queries_used": [],
  "filters_used": ["upcase"],
  "tags_used": [],
  "translation_keys": [],
  "doc_params": ["title"]
}
```

(`{% doc %}` is a raw tag, so it is correctly absent from `tags_used`; its
`@param` names surface as `doc_params`.)

---

## 6. Open doubts / risks / follow-ups

> Post-review status. Doubt #1 was the review's High finding (F1) and is now
> **resolved**; the rest are unchanged unless annotated. See §8 for the full
> mapping of doubts → findings → fixes.

1. ~~**`structural` is built but not surfaced in `validate_code`.**~~
   **SUPERSEDED (TASK-9.10 — §9).** §8/F1 briefly surfaced `structural`, but the
   whole-branch analysis showed `dependencies`/`structural` were redundant with
   lint (they echo the buffer the agent just wrote). Both were **removed** from
   `validate_code`; the graph's real contribution is the cross-file `impact`
   (blast radius) instead. The graph primitives remain for `project_map`/
   `validate_project`.

2. ~~**Project-wide queries need a cached full build.**~~ **RESOLVED (TASK-9.10 —
   §9).** A never-stale, fingerprint-validated `GraphCache` at the supervisor edge
   now backs `validate_code`'s `impact` (dependents / blast radius). It amortizes
   the parse-heavy full build and reports `computing` rather than serving stale.
   (ADR 003 open question #5 is now marked resolved.) `nearestModules` /
   project-wide orphans remain for `validate_project` (TASK-9.12).

3. **`orphans()` completeness depends on how the graph was built.** `buildAppGraph`
   only materializes modules reachable from entry points (+ schema on a full
   build). To list genuinely-unreferenced partials you must build with every file
   as an entry point. Documented in `query.ts` and now in the `buildAppGraph`
   JSDoc (§8/F4); a convenience "whole-project" build mode may be worth adding.

4. **graphql `table` extraction is path/AST-based, single-style.** It reads the
   first `table` object/`table:"x"` filter via the GraphQL AST. Exotic query
   shapes (computed table, multiple tables) resolve to the first/none. Adequate for
   resource grouping; not a full GraphQL semantic analysis. (The extractor moved
   to check-common alongside `extractSchemaTable` — §8/F7 — but its behavior is
   unchanged.)

5. **Schema table name = the YAML `name:`.** Files with no (or a non-string)
   `name:` get a node with `table` undefined. The review made the non-string
   handling explicit and consistent with the slug rule (§8/F8), but the underlying
   "we key schemas by `name:`" assumption stands; a project that keys schemas
   differently would miss the join in TASK-9.7.

6. **TASK-9.7 (resource/CRUD completeness) is deferred by design.** It's the
   commands/queries convention overlay; per ADR 004 it must NOT enter the graph.
   Its home (supervisor domain layer vs a configurable check) and the
   configurable path-roots are decided in the ADR but not implemented.

7. **The `TypeSystem.spec` timeout** is a pre-existing local-only flake (5s default
   timeout under full-suite parallel load). Not caused by this branch (verified via
   stash baseline **and** re-confirmed during review: the test passes in ~3.1s in
   isolation); CI is green. If it becomes noisy, bump that one test's timeout — but
   it is _not_ masking a real failure.

8. **`validate_code` re-globs + re-parses the whole project every call.** The
   dominant per-call cost is check-node's `getApp` (glob + parse the entire
   project) inside `lintBuffer`, with no memoization — pre-existing, not introduced
   by this branch. The review scoped this out (§8/F3) and recommends memoizing
   `getApp` per project as separate work; it is the high-value perf lever, well
   above the buffer-parse micro-optimizations.

---

## 7. Task ledger (TASK-9 epic)

| Task                                                                             | Status                                                      |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 9.1 dependency edges (render/include/function/background/graphql/asset)          | ✅ Done                                                     |
| 9.2 project-structure query API (dependents/orphan/reachability/missing/nearest) | ✅ Done                                                     |
| 9.3 per-file self-structural (9 facts)                                           | ✅ Done                                                     |
| 9.4 layout edges + `DocumentsLocator 'layout'`                                   | ✅ Done                                                     |
| 9.5 wire graph `dependencies` into `validate_code`                               | ✅ Done                                                     |
| 9.6 platform facts (graphql `table`, schema nodes)                               | ✅ Done                                                     |
| 9.7 resource/CRUD convention overlay                                             | ⬜ Deferred (ADR 004)                                       |
| 9.8 code-review remediation (§8)                                                 | ✅ Done (F3 deferred)                                       |
| 9.9 asset-resolution fix + real-project validation                               | ✅ Done                                                     |
| **9.10 cached graph → blast-radius in `validate_code`** (§9)                     | ✅ Done                                                     |
| 9.11 `project_map` (discovery + resource overlay)                                | ⬜ Scoped                                                   |
| 9.12 `validate_project` (health sweep + repair order)                            | ⬜ Scoped                                                   |
| 9.13 opt-in `AppCache` (parsed-project reuse for lint)                           | ✅ Done                                                     |
| **9.14 `applyFileChange` incremental graph API** (§10.1)                         | ✅ Done                                                     |
| **9.15 warm/incremental/persisted GraphCache** (§10.2)                           | ◐ Phases 1–2 done; Phase 3 (fs.watch + scoped walk) pending |
| 8.4 surface `structural` in `validate_code`                                      | ↩︎ Superseded by 9.10 (removed)                              |

**The three-tool graph strategy** (why the graph lives mostly _outside_
`validate_code`): lint owns the per-file forward-looking checks, so the graph's
value is cross-file. It is surfaced through three intent-shaped tools —
`validate_code` **blast radius** (change safety, at edit time — 9.10, done),
`project_map` (discovery, at task start — 9.11), and `validate_project` (health
sweep + dependency-ordered repair plan, at task end — 9.12).

ADRs: `docs/mcp-supervisor/decisions/003-…` (resolved, incl. Q#5 via 9.10),
`004-platform-facts-vs-conventions` (accepted).

---

## 8. Code review & remediation

Before submitting, the full branch (`git diff master...HEAD`) went through a
high-effort review: **8 independent finder angles** (3 correctness — line-by-line,
removed-behavior, cross-file tracer; 3 cleanup — reuse, simplification, efficiency;
1 altitude; 1 conventions/CLAUDE.md), each returning candidate findings, then a
recall-biased verification pass. **11 findings** survived. **10 were fixed, 1
deferred** with rationale. Every fix was landed surgically with the relevant
package suites, type-check, and format re-run green after each. Tracked in
**TASK-9.8**.

### What the review confirmed clean (no action)

- **CLAUDE.md conventions:** no violations. Path handling uses the sanctioned
  `URI.file()` + check-common `normalize()` (no manual `\\`→`/`); new tests use
  whole-value `toEqual` (the `.toBe(true/false)`/`.toBeNull()` cases fall under the
  documented boolean/presence exception).
- **Type-safety / exhaustiveness:** `assertNever` in the `ModuleType` switch still
  compiles; `SerializableNode` does **not** leak `structural`/`table`; the new
  required `dependencies` field flows through the single constructor.
- **Refuted candidates:** `path.relative` arg order is correct; `runStructure` is
  safe on non-Liquid buffers (resolver returns `[]` on an `Error` AST); layout node
  dedup already held on Linux + Windows CI (F10 is hardening, not a live bug).

### Findings & fixes

Severity in brackets. Each links the area touched.

**F1 — [Architecture/High] Self-structural was built but unreachable, and the LSP
paid for it.** The graph populated `LiquidModule.structural` on every full build,
but (a) `validate_code` uses the per-file path and so returned `"structural": null`,
and (b) the LSP — the only full-build caller — never reads `structural` yet paid to
compute it each rebuild. **Fix:** exported `extractStructural(sourceCode, uri)` as a
per-file primitive (non-Liquid-safe → `undefined`); the supervisor's structure
adapter now returns `{ dependencies, structural }` from **one shared parse**; eager
per-module population is gated behind `buildAppGraph(..., { includeStructural })`
(default off). Added `graphql_queries_used` to the supervisor's structural snapshot
for parity with the graph model. _(User decision: full fix incl. the LSP gate.)_

**F2 — [Robustness/Med] A structure-adapter failure could sink the lint gate.**
`validate_code` ran `Promise.all([lint, structure])`; a rejection in the secondary
structure adapter would discard the primary `must_fix_before_write` diagnostics.
**Fix:** structure failure now degrades to `{ dependencies: [], structural: null }`
(logged); lint stays primary and still propagates. Covered by an injectable-adapter
unit spec (degrade + propagate + passthrough).

**F3 — [Efficiency/Med] DEFERRED.** The edited buffer is parsed by the structure
adapter and again inside `lintBuffer`. Fully de-duping this needs an additive change
to check-node's shared `lintBuffer` API and cross-file-type parse reconciliation,
for a saving that is marginal against the pre-existing whole-project `getApp` parse
(doubt #8) that dominates each call. Deferred with a recommendation to memoize
`getApp` per project instead. _(The intra-adapter half — sharing one parse between
`extractFileReferences` and `extractStructural` — was done as part of F1.)_

**F4 — [Altitude/Med] Schema-discovery contract was implicit.** Discovery keyed on
`entryPoints === undefined`, and `isOrphan` special-cased `type === Schema`. **Fix
(user decision: document, keep the discriminant):** the `buildAppGraph` JSDoc now
states the full-build (auto-discovers pages+layouts+schema) vs scoped (verbatim; no
schema) contract explicitly; the `ModuleType.Schema` guard stays as the idiomatic
single-property check. We **deliberately did not** add a speculative
`standalone`/`reachabilityParticipating` flag — with one non-reachability leaf kind
it would be more state to keep in sync, not less (YAGNI until a second appears).

**F5 — [Reuse/Med] Three duplications collapsed to shared helpers.**

- (a) `toAbsoluteFilePath` + `AdapterInput` shared by the `lint` and `structure`
  adapters (was copy-pasted `node:path` resolution).
- (b) `effectivePageSlug` in `platformos-common` is now the single slug-derivation,
  used by both `RouteTable` and the graph — which also **fixed a latent drift**: the
  graph previously ignored a frontmatter `format:` override that `RouteTable` honors.
- (c) `isTranslationKeyUsage` in check-common is the single "string literal piped
  through `t`/`translate`" predicate, used by both the `TranslationKeyExists` check
  and `extractStructural`.

**F6 — [Efficiency/Low-Med] Redundant traversals removed.** `extractStructural` now
does **one** AST walk — doc `@param` names are collected in the same pass (reading
the parser-produced `LiquidDocParamNode`, not re-implementing the liquid-doc parser)
instead of a second `extractDocDefinition` traversal. `buildAppGraph` now does
**one** directory sweep, partitioning pages/layouts and schema files by extension
(was two full-tree walks). _(This fix also surfaced a real type error — see the
tooling note below.)_

**F7 — [Altitude/Low] Schema `table` extraction moved beside the parser.** Added
exported `extractSchemaTable` in check-common (mirrors `extractGraphqlTable`, reuses
the `js-yaml` that package already owns); the graph consumes it instead of an inline
local parse — symmetric ownership for the two "platform table" facts.

**F8 — [Correctness/Low] Non-string `slug`/`name` handled consistently.** Routing
the graph's slug through `effectivePageSlug` (F5b) makes non-string frontmatter
`slug` behave exactly as `RouteTable` does (the routing source of truth), rather
than diverging; `extractSchemaTable` similarly ignores a non-string `name:`.

**F9 — [Altitude/Low] `ValidateCodeDependency.kind` is now a real seam.** Was typed
`string` (stringly-typed yet still 1:1 coupled to the upstream `ReferenceKind`).
**Fix:** a supervisor-owned `ValidateCodeDependencyKind` union is the agent contract,
and the adapter maps `ReferenceKind → ` it through an exhaustive
`Record<ReferenceKind, …>` — so an upstream add/rename is a **compile error** at the
seam, never a silent change to the agent surface.

**F10 — [Latent/Low] Layout node identity hardened.** `getLayoutModule` /
`getPageModule` now normalize their stored URI like the other four factories, so a
node discovered as an entry point (raw fs URI) keys identically to the same file
resolved as an edge target (DocumentsLocator + normalized) — one node, never a split
identity that would drop an incoming edge. New `module.spec.ts` proves dedup across
backslash vs forward-slash URIs (each assertion would fail without the fix).

**F11 — [Simplification/Minor]** `argNames` dropped a statically-always-true filter;
a single `argsField` helper is the one place the "omit `args` when empty" rule lives
(was duplicated in `bind` and `extractFileReferences`); the single-use
`frontmatterBody` → `loadFrontmatterOf` chain was collapsed.

### Doubt → finding map

| Pre-review doubt (§6)          | Review finding | Outcome                            |
| ------------------------------ | -------------- | ---------------------------------- |
| #1 structural not surfaced     | F1             | Fixed                              |
| #8 whole-project re-parse cost | F3             | Deferred (recommend `getApp` memo) |
| #3 orphans completeness        | F4             | Contract documented                |
| #4 graphql table single-style  | F7             | Moved (behavior unchanged)         |
| #5 schema table = `name:`      | F8             | Non-string handling made explicit  |
| #7 TypeSystem flake            | —              | Re-confirmed unrelated             |

### Tooling note (worth a reviewer's attention)

During F6, `npx tsc --noEmit` caught a real control-flow-narrowing error
(`entryPoints` possibly `undefined`) that the `yarn workspace <pkg> type-check`
wrapper **and** the vitest runs silently passed over. Type-checking in this review
was therefore done with **direct `tsc --noEmit` per package**. If CI relies on the
`yarn workspace` wrapper for type-checking, that gap is worth closing separately.

### Review-era changes to the public surface (for the reviewer's eye)

All additive except two intentional output improvements and one perf default:

- `buildAppGraph` gains an optional 4th arg `options: GraphBuildOptions`
  (`includeStructural`, default off). **Behavior change:** a full build no longer
  populates `module.structural` unless opted in — intentional (F1); no current
  consumer read it.
- New exports: `extractStructural`, `GraphBuildOptions` (graph); `extractSchemaTable`,
  `isTranslationKeyUsage`, `TRANSLATION_FILTERS` (check-common); `effectivePageSlug`
  (common).
- `validate_code` result: `structural` is now populated (was always `null`);
  `dependencies[].kind` is now a typed union (was `string`). Both are widened/filled,
  not removed — existing consumers keep working.

---

## 9. Cached graph → blast radius in `validate_code` (TASK-9.10)

### Why (the reframing)

The whole-branch review (§8) established that the graph's per-file outputs in
`validate_code` were **redundant with lint**: broken references →
`MissingPartial`/`MissingAsset`; argument correctness → `PartialCallArguments`;
the rest echoed the buffer the agent just wrote. The one thing lint _structurally
cannot_ do is the **backward / cross-file** direction — "editing this file breaks
its N callers." TASK-9.10 delivers exactly that and removes the redundant fields.

### What shipped

- **`GraphCache`** (`src/graph-cache/`) — one per project/server. Builds the full
  `AppGraph` once (all liquid files as entry points → **complete dependents**) and
  reuses it, background-built and **never awaited** on the request path.
- **`impact`** in the `validate_code` result (`src/impact/`):
  - `dependents`: `{ total, by_kind, sample≤10 }` — who references the edited file
    (via `dependentsOf`), distinct files, capped, sorted;
  - `signature_risk`: dependent callers whose passed args (from the graph's edge
    `args`) violate the buffer's `{% doc %}` contract — missing a required
    `@param` or passing an undeclared one. The cross-file **inverse** of
    `PartialCallArguments`; conservative (doc-block only, no inference);
  - `status`: `computed | computing | unavailable`.
- **Removed** `dependencies` and `structural` from the result (+ the dead
  structure adapter). Graph primitives kept for CLI / serialize / 9.11 / 9.12.

### Freshness — never stale (the load-bearing decision)

Staleness would mislead the agent (a stale "0 dependents → safe to change" is the
worst-case), so **TTL and stale-while-revalidate were both rejected**. The cache
is **fingerprint-validated on every request**: a cheap `mtime:size` stat-scan over
the edge-source liquid files (page/layout/partial+lib — the only files whose
change can alter any dependents). Fingerprint matches → serve; otherwise report
`computing` and rebuild in the background. The agent validates in-flight _buffers_
without writing to disk, so the fingerprint stays matched across a burst (fresh
every call); a rebuild triggers only after an actual write.

Buffer overlay is **not** needed for dependents (who points _at_ the file lives in
_other_ files, unaffected by the buffer); the buffer is used only to read the
current `{% doc %}` for `signature_risk`.

### Degrade contract (F2)

`impact` is secondary: a graph-build failure or an impact-adapter throw degrades
to `status: 'unavailable'` (logged) and **never** sinks the lint gate.

### Worked example — signature-impact

`home.liquid` renders `card` with no args. Editing `card` to add a required
`@param title`:

```json
"impact": {
  "scope": "direct",
  "status": "computed",
  "dependents": { "total": 1, "by_kind": { "render": 1 }, "sample": ["app/views/pages/home.liquid"] },
  "signature_risk": [
    { "caller": "app/views/pages/home.liquid", "missing_required": ["title"], "unexpected_args": [] }
  ]
}
```

### Tests

`graph-cache.spec` (never-stale/dedup/failure state machine + a real-fixture
integration proving rebuild-on-change), `impact.spec` (dependents shaping +
signature-impact), `validate-code.spec` (lint/impact orchestration + degrade),
and a `stdio-smoke` end-to-end (real cached graph over the transport: dependents,
safe-to-change, and signature-impact). Supervisor suite: **55**.

### Measured cost (real 1,505-node project `marketplace-dcra`)

- **Warm request (fresh graph served): ~400 ms** — the fingerprint stat-scan.
  Sub-second, and it runs _concurrently_ with lint's own multi-second
  whole-project parse, so blast-radius adds ≈0 wall-clock.
- **Cold first fingerprint: ~8 s** (cold OS cache; dominated by walking the whole
  tree, incl. non-platformOS dirs like `react-app/`) — hidden behind lint's own
  slower cold parse of the same files.
- **Background build: ~22 s** — never awaited on the request path.

### Open follow-ups

- The fingerprint (and the build's entry-point enumeration) walks the whole tree;
  scoping the walk to platformOS dirs (or reusing lint's file list) would cut the
  ~400 ms warm cost. Not a 9.10 regression (same walk `buildAppGraph`/lint already
  do); worth a follow-up.
- Cold-start: the first blast-radius request (or the first after a write) returns
  `computing` until the background build finishes; a bounded await for small
  projects is a possible future nicety (deliberately omitted to never delay lint).
- `getApp` memoization (doubt #8) remains the higher-value perf lever, unchanged.

> The first two follow-ups above are resolved by §10 (incremental apply removes the
> post-write `computing` gap; persistence removes the cold-build wait). Scoping the
> walk is the remaining Phase-3 item.

---

## 10. Always-fresh graph — incremental + persisted (TASK-9.14 / 9.15)

§9 shipped a _correct, never-stale_ cache, but it FULL-rebuilt (~22 s) on any
change, so blast-radius went `computing` for ~22 s after every write, and cold
start paid the full build. The graph is **"embarrassingly incremental"**: a
file's outgoing edges depend only on its own content (no cross-file inference),
so a change is applied in `O(edges of the changed file)`. We apply the proven
playbook (rust-analyzer/Salsa demand-driven incremental, LSP
`didChangeWatchedFiles`, TS `--incremental`, bundler HMR) rather than invent.

**The never-stale mandate is preserved throughout: the fingerprint is the
AUTHORITY.** Incremental apply is _driven by_ the fingerprint diff; any detected
inconsistency falls back to a full rebuild; a persisted graph is reconciled
against the fingerprint after load. Watch/persistence = speed; fingerprint =
truth.

### 10.1 `applyFileChange` — incremental graph update (TASK-9.14, platformos-graph)

New `packages/platformos-graph/src/graph/incremental.ts`, exported from the
package index (structure logic lives in the graph package, per ADR 003):

```
applyFileChange(graph, uri, kind: 'added'|'modified'|'deleted', deps, options?)
```

- Reuses the _exact_ build seams — `resolveLiquidReferences` (now exported) +
  the URI-normalizing module factories + `bind` — so an incremental result can
  never drift from a from-scratch build. No forked resolution.
- `modified = removeFile + addFile`. `removeFile` detaches the file's outgoing
  edges from each target's reverse index, garbage-collects any target that
  becomes an unreachable non-entry-point leaf (matching a full build's
  omission), drops it from `entryPoints`, then removes the node unless still
  referenced (kept `exists:false`). `addFile` materializes/refreshes the node,
  registers edge-source liquid files as entry points, and resolves + binds its
  outgoing edges (materializing any newly-reached leaf with its `table` fact).
- Incoming edges to an added/deleted file resolve automatically via the `exists`
  flag — an edge is keyed by its canonical target URI, so flipping `exists`
  re-resolves it with no rewiring.
- Dependencies are augmented **fresh per call** (like the build), so the changed
  file — and any newly-reachable leaf — is re-read from disk, never a stale
  parse. Precondition: the graph was built with every edge-source liquid file as
  an entry point (the cache's mode).

**Guardrail (the correctness invariant):** `incremental.spec.ts` mutates a real
temp project on disk, applies the change, and asserts
`serializeAppGraph(incremental)` is canonically identical to a fresh
`buildAppGraph` of the same disk state — across add / modify / delete, missing-
target `exists` flips, leaf GC, self-reference, cycles, and mixed sequences.

### 10.2 Warm, incremental, persisted `GraphCache` (TASK-9.15)

**Phase 1 — incremental apply.** On a fingerprint move with a graph already in
memory, the cache DIFFS the fingerprint (`diffFingerprints` → added/modified/
deleted) and applies only the changed files via `applyFileChange`, then serves
the updated graph **immediately** — no rebuild, no `computing` gap after a write.
Reconciliations are serialized (a promise chain) so concurrent lookups never
interleave mutations of the shared graph; a queued reconcile that another run
already caught up to is a no-op. If incremental apply ever throws, the cache
discards the graph and falls back to a full rebuild — a half-applied graph is
never served.

**Phase 2 — persistence (warm cold start).** The built graph + its per-file
fingerprint + entry-point URIs are persisted to a versioned JSON cache file
(`graph-cache-store.ts`; `serializeAppGraph` + the new `deserializeAppGraph`,
which seeds the module identity cache so a loaded graph reconciles exactly like a
freshly-built one). On cold start the cache LOADS the persisted graph and
reconciles the on-disk delta incrementally instead of a ~22 s build. Persistence
is off the request path and coalesced (a burst of edits collapses to one write,
always writing the latest state). A missing / corrupt / wrong-version /
wrong-root cache decodes to `null` and falls back to a full build; the
fingerprint still gates correctness after load, so a stale cache converges to
fresh and a bad one never yields a wrong answer. Default cache file:
`<tmpdir>/platformos-mcp-supervisor/graph-<sha256(rootUri)>.json` (a rebuildable
derivative; wired by the server, disableable by omitting `cachePath`).

**Measured — real project `marketplace-dcra` (2,170 nodes, 1,921 entry points):**

|                      | Before (§9)                          | After (§10)                                                                            |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| Post-write freshness | `computing` for ~22 s (full rebuild) | fresh **immediately** (incremental apply, ~ms)                                         |
| Cold start           | ~22 s full build                     | **~37 ms** persisted load (+ delta reconcile) — vs a **70 s** cold build here → ~1900× |
| Serialize + persist  | —                                    | ~48 ms (1.4 MiB)                                                                       |

**Tests.** `incremental.spec.ts` (equivalence guardrail), `deserialize.spec.ts`
(round-trip + a restored graph reconciles exactly like a full build),
`graph-cache-store.spec.ts` (encode/decode + version/root/corruption
invalidation), `graph-cache.spec.ts` (incremental serve, diff kinds, apply-
failure fallback, concurrent-reconcile coalescing, warm cold-start from disk,
delta reconcile after warm, corrupt→rebuild). Supervisor + graph suites,
type-check, and format green.

**Phase 3 (pending).** `fs.watch` background freshness (with the fingerprint
reconciliation kept as the safety net — never trust the watcher alone) so the
request path does no per-call scan on the steady state; and scoping the file
walk to platformOS dirs (cuts the residual ~400 ms warm fingerprint cost —
resolves the first §9 follow-up).
