# Supervisor ⇄ Graph Integration

Branch: `supervisor-graph-integration`

This document is the PR-style summary **and** the architectural reference for the
work that makes `platformos-graph` the project structural/dependency model and
wires it into the MCP supervisor's `validate_code`. It covers what shipped, the
decisions (with ADR links), the full graph feature surface, worked output
examples, and the open doubts.

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
  targets with kind + 1-based position, alongside lint diagnostics.
- **Project-structure query API** — dependents / orphans / reachability /
  missing-target / nearest-name ("did you mean").
- **Per-file self-structural** — `renders_used`, `graphql_queries_used`,
  `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`,
  `layout`, `method`, surfaced on each module as a parse by-product.
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

### Verification (final)
| Package | Tests |
|---|---|
| platformos-graph | **73** |
| platformos-check-common | **1047** |
| platformos-mcp-supervisor | **50** (incl. 7 stdio end-to-end) |
| platformos-language-server-common | **467** |

All packages type-check clean; `yarn format:check` clean; `--frozen-lockfile`
clean. The **only** red anywhere is a pre-existing, local-only timeout in
`TypeSystem.spec` (a heavy LSP type-inference test that exceeds 5s only under
full-suite parallel load on a contended machine — proven unrelated by a stash
baseline; CI does not hit it).

> **Working-tree note:** the last commit on the branch is the query API
> (`nearestModules`). The most recent slices — graphql `table`, schema nodes,
> per-file self-structural, ADR 004 — are **staged in the working tree, not yet
> committed**. Commit before opening the PR.

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

1. **`buildAppGraph(rootUri, deps, entryPoints?)`** — full project graph from
   disk. Entry points default to pages + layouts; traversal follows edges; a full
   build additionally discovers standalone **schema** nodes. Populates incoming
   `references`, `exists`, `table`, and `structural`.
2. **`extractFileReferences(rootUri, sourceUri, sourceCode, { fs })`** — one
   file's **outgoing** edges from an **in-flight buffer** (parsed by the caller,
   may not be on disk). No whole-graph build, no reachability requirement. This is
   what `validate_code` uses.

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
| `buildAppGraph(rootUri, deps, entryPoints?)` | Build the full project graph from disk |
| `extractFileReferences(rootUri, sourceUri, sourceCode, { fs })` | One buffer's outgoing edges (no full build) |
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
| `ModuleStructural` (on `LiquidModule.structural`) | The file's own declarations |

There is also a CLI (`bin/platformos-graph`): `platformos-graph <root> [file]`.

### What `validate_code` discovers today
Per call (`{ file_path, content, mode }`), in one pass over the in-flight buffer:
- **Lint** (check-node `lintBuffer`): errors / warnings / infos with 1-based
  positions, `must_fix_before_write` gate, `status`.
- **`dependencies`** (graph `extractFileReferences`): every statically-resolvable
  outgoing edge — `kind`, **project-relative resolved target**, 1-based line/col.
  This is the "how it sits in the project" signal. It does **not** re-flag missing
  targets (the linter's `MissingPartial` already does); its value is the
  canonical resolved path + kind.

Still graph-side / not yet surfaced in `validate_code` (see §6): the project-wide
queries (dependents/orphans/nearest-name) and the self-`structural` snapshot.

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
  "structural": null
}
```

Note the clean separation: the **lint error** and the **resolved dependencies**
coexist without conflation. `dependencies` resolves the frontmatter `layout`, the
`{% function %}` lib query, and the `{% render %}` partial to their canonical
project-relative paths with exact positions.

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

1. **`structural` is built but not surfaced in `validate_code`** (`"structural": null`
   above). Wiring it is **TASK-8.4** (result shaping). It's also a full-build node
   fact; the per-file `extractFileReferences` path doesn't compute it — so to put
   self-structural in `validate_code` we either (a) add a per-buffer structural
   extractor (the AST is already parsed in the structure adapter — cheap), or (b)
   keep it project-build-only. **Decision needed.** Recommendation: (a), reusing
   the same `extractStructural` over the buffer AST.

2. **Project-wide queries need a cached full build.** `dependentsOf`, `orphans`,
   `nearestModules` require `buildAppGraph` (O(project), parse-heavy). `validate_code`
   currently does a per-file build only. Surfacing "who renders this / did-you-mean"
   to the agent needs a cached graph at the supervisor edge (ADR 003 open question
   #5 — TTL vs explicit invalidation). Not built.

3. **`orphans()` completeness depends on how the graph was built.** `buildAppGraph`
   only materializes modules reachable from entry points (+ schema). To list
   genuinely-unreferenced partials you must build with every file as an entry
   point. Documented in `query.ts`; a convenience "whole-project" build mode may be
   worth adding.

4. **graphql `table` extraction is path/AST-based, single-style.** It reads the
   first `table` object/`table:"x"` filter via the GraphQL AST. Exotic query
   shapes (computed table, multiple tables) resolve to the first/none. Adequate for
   resource grouping; not a full GraphQL semantic analysis.

5. **Schema table name = the YAML `name:`.** Files with no `name:` get a node with
   `table` undefined (matching the old scanner's skip-ish behavior, but we still
   model the node). If a project keys schemas differently, the join in TASK-9.7
   would miss them.

6. **TASK-9.7 (resource/CRUD completeness) is deferred by design.** It's the
   commands/queries convention overlay; per ADR 004 it must NOT enter the graph.
   Its home (supervisor domain layer vs a configurable check) and the
   configurable path-roots are decided in the ADR but not implemented.

7. **The `TypeSystem.spec` timeout** is a pre-existing local-only flake (5s default
   timeout under full-suite parallel load). Not caused by this branch (verified via
   stash baseline); CI is green. If it becomes noisy, bump that one test's timeout
   — but it is *not* masking a real failure.

8. **Branch name typo** (`supervisor-graph-integration` is fine; the upstream graph
   work lived on `extend-platfomos-graph` — note the misspelling there if cherry-
   picking history).

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
| 8.4 surface `structural` in `validate_code` | ⬜ Open (doubt #1) |

ADRs: `docs/mcp-supervisor/decisions/003-…` (resolved), `004-platform-facts-vs-conventions` (accepted).
