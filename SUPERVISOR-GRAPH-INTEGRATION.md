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
> understand *what changed as a result of review and why*. The rest of this
> document reflects the **post-review** state.

---

## 1. PR summary

### What & why
The rebuilt `platformos-mcp-supervisor` must tell coding agents not just *what is
wrong* in a file but *how the file sits in the project* — what it renders/calls,
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
- **`validate_code` now returns `dependencies`** — resolved, project-relative
  targets with a typed `kind` + 1-based position, alongside lint diagnostics.
- **`validate_code` now returns `structural`** *(added in review — §8/F1)* — the
  file's own declarations for the in-flight buffer.
- **Project-structure query API** — dependents / orphans / reachability /
  missing-target / nearest-name ("did you mean").
- **Per-file self-structural** — `renders_used`, `graphql_queries_used`,
  `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`,
  `layout`, `method`, exposed both as the per-file primitive `extractStructural`
  *(exported in review — §8/F1)* and, opt-in, on each module during a full build.
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
- **The LSP and `validate_code` outputs are unchanged** except the deliberate
  new `dependencies` field — verified by whole-result assertions.
- Cross-package safety re-verified after every slice: graph, check-common,
  check-node, language-server, supervisor.

### Verification (final, post-review)
| Package | Tests | Δ from pre-review |
|---|---|---|
| platformos-common | **257** | +12 (`effectivePageSlug`) |
| platformos-graph | **80** | +7 (structural opt-in/primitive, node-identity) |
| platformos-check-common | **1057** | +10 (`extractSchemaTable`) |
| platformos-mcp-supervisor | **56** | +6 (orchestration, structural, adapter) |
| platformos-language-server-common | **467** | unchanged |

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
3. **`extractStructural(sourceCode, uri)`** *(exported in review — §8/F1)* — the
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
  a *configurable* check (disable-able for non-`core` apps).

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
  *edges* (it's referenced by table name), so `isOrphan` explicitly excludes
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

| Export | Purpose |
|---|---|
| `buildAppGraph(rootUri, deps, entryPoints?, options?)` | Build the full project graph from disk; `options.includeStructural` opts into per-module `structural` |
| `extractFileReferences(rootUri, sourceUri, sourceCode, { fs })` | One buffer's outgoing edges (no full build) |
| `extractStructural(sourceCode, uri)` | One buffer's self-structural (no build); `undefined` for non-Liquid/unparseable |
| `serializeAppGraph(graph)` | JSON `{ rootUri, nodes, edges }` |
| `toSourceCode(uri, source)` | Parse a buffer into a `FileSourceCode` |
| `dependenciesOf(graph, uri)` | Outgoing edges (what it renders/calls/wraps) — call sites w/ kind + args |
| `dependentsOf(graph, uri)` | Incoming edges (who renders/calls it) |
| `exists(graph, uri)` | Does it resolve to a real file |
| `isEntryPoint(graph, uri)` | Is it a page/layout root |
| `isOrphan(graph, uri)` / `orphans(graph)` | Unreferenced dead files (schema-guarded) |
| `reachableFrom(graph, uri)` | Transitive outgoing closure |
| `missingDependencies(graph, uri)` / `missingTargets(graph)` | Unresolved edges |
| `nearestModules(graph, uri, { limit?, maxDistance? })` | Same-category "did you mean" by edit distance |
| `ModuleStructural` / `GraphBuildOptions` | Self-structural shape; build options |

There is also a CLI (`bin/platformos-graph`): `platformos-graph <root> [file]`.

### What `validate_code` discovers today
Per call (`{ file_path, content, mode }`), over the in-flight buffer (parsed
**once**, shared by the two graph primitives — §8/F1):
- **Lint** (check-node `lintBuffer`): errors / warnings / infos with 1-based
  positions, `must_fix_before_write` gate, `status`.
- **`dependencies`** (graph `extractFileReferences`): every statically-resolvable
  outgoing edge — typed `kind`, **project-relative resolved target**, 1-based
  line/col. This is the "how it sits in the project" signal. It does **not**
  re-flag missing targets (the linter's `MissingPartial` already does); its value
  is the canonical resolved path + kind.
- **`structural`** (graph `extractStructural`) *(wired in review — §8/F1)*: the
  file's own declarations for this buffer (`renders_used`, `graphql_queries_used`,
  `filters_used`, `tags_used`, `translation_keys`, `doc_params`, and the routing
  facts `slug`/`layout`/`method`), or `null` for a non-Liquid/unparseable buffer.

Still graph-side / not yet surfaced in `validate_code` (see §6): the project-wide
queries (dependents/orphans/nearest-name), which need a cached full build.

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
      "line": 1, "column": 1, "end_line": 1, "end_column": 1
    }
  ],
  "warnings": [],
  "infos": [],
  "proposed_fixes": [],
  "clusters": [],
  "scorecard": [],
  "dependencies": [
    { "kind": "layout",   "target": "app/views/layouts/theme.liquid",   "line": 1, "column": 1 },
    { "kind": "function", "target": "app/lib/queries/list.liquid",       "line": 4, "column": 1 },
    { "kind": "render",   "target": "app/views/partials/header.liquid",  "line": 5, "column": 13 }
  ],
  "parse_error": null,
  "tips": [],
  "domain_guide": null,
  "structural": {
    "renders_used": ["header"],
    "graphql_queries_used": [],
    "filters_used": [],
    "tags_used": ["function", "render"],
    "translation_keys": [],
    "doc_params": [],
    "slug": null,
    "layout": "theme",
    "method": null
  }
}
```

Note the clean separation of three signals that coexist without conflation:
- the **lint error** (`MissingContentForLayout`);
- the **resolved dependencies** — the frontmatter `layout`, the `{% function %}`
  lib query, and the `{% render %}` partial, each resolved to its canonical
  project-relative path with an exact position;
- the file's own **structural** facts — what it renders (`header`), the tags it
  uses (`function`, `render`), and its routing (`layout: theme`; `slug`/`method`
  are `null` because this is a layout, not a page).

The `structural` block was `null` in the pre-review revision (built on graph
modules but not reachable from the per-file `validate_code` path); §8/F1 exported
`extractStructural` and wired it in.

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

1. ~~**`structural` is built but not surfaced in `validate_code`.**~~ **RESOLVED
   (§8/F1).** `extractStructural` is now an exported per-file primitive; the
   supervisor computes `structural` for the in-flight buffer over the same parse
   it uses for `dependencies`, and eager per-module population on a full build is
   now opt-in (`includeStructural`, default off) so the LSP stops paying for a
   fact it never reads.

2. **Project-wide queries need a cached full build.** `dependentsOf`, `orphans`,
   `nearestModules` require `buildAppGraph` (O(project), parse-heavy). `validate_code`
   currently does a per-file resolution only. Surfacing "who renders this /
   did-you-mean" to the agent needs a cached graph at the supervisor edge (ADR 003
   open question #5 — TTL vs explicit invalidation). Not built.

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
   it is *not* masking a real failure.

8. **`validate_code` re-globs + re-parses the whole project every call.** The
   dominant per-call cost is check-node's `getApp` (glob + parse the entire
   project) inside `lintBuffer`, with no memoization — pre-existing, not introduced
   by this branch. The review scoped this out (§8/F3) and recommends memoizing
   `getApp` per project as separate work; it is the high-value perf lever, well
   above the buffer-parse micro-optimizations.

---

## 7. Task ledger (TASK-9 epic)

| Task | Status |
|---|---|
| 9.1 dependency edges (render/include/function/background/graphql/asset) | ✅ Done |
| 9.2 project-structure query API (dependents/orphan/reachability/missing/nearest) | ✅ Done |
| 9.3 per-file self-structural (9 facts) | ✅ Done |
| 9.4 layout edges + `DocumentsLocator 'layout'` | ✅ Done |
| 9.5 wire graph `dependencies` into `validate_code` | ✅ Done |
| 9.6 platform facts (graphql `table`, schema nodes) | ✅ Done |
| 9.7 resource/CRUD convention overlay | ⬜ Deferred (ADR 004) |
| 9.8 code-review remediation (this review — §8) | ✅ Done (F3 deferred) |
| 8.4 surface `structural` in `validate_code` | ✅ Done (via §8/F1) |

ADRs: `docs/mcp-supervisor/decisions/003-…` (resolved), `004-platform-facts-vs-conventions` (accepted).

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
for parity with the graph model. *(User decision: full fix incl. the LSP gate.)*

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
`getApp` per project instead. *(The intra-adapter half — sharing one parse between
`extractFileReferences` and `extractStructural` — was done as part of F1.)*

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
(was two full-tree walks). *(This fix also surfaced a real type error — see the
tooling note below.)*

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
| Pre-review doubt (§6) | Review finding | Outcome |
|---|---|---|
| #1 structural not surfaced | F1 | Fixed |
| #8 whole-project re-parse cost | F3 | Deferred (recommend `getApp` memo) |
| #3 orphans completeness | F4 | Contract documented |
| #4 graphql table single-style | F7 | Moved (behavior unchanged) |
| #5 schema table = `name:` | F8 | Non-string handling made explicit |
| #7 TypeSystem flake | — | Re-confirmed unrelated |

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
