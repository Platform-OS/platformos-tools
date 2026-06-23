# Graph-backed structural enrichment: extend platformos-graph, the supervisor consumes

## Status

Proposed (2026-06-12).

## tl;dr

The original pos-supervisor told agents not just *what is wrong* in a file but
*how the file sits in the project* — who renders it, what it renders, whether
it is orphaned, whether a render target is missing, "did you mean" candidates,
and a project-map of resources. We want that back in the rebuilt
`validate_code`. Per our architecture principle, **the supervisor must remain a
pure consumer**: all graph / project-structure functionality lives in
`platformos-graph` (extended as needed), never re-implemented in the
supervisor. This record captures (1) what the old tool surfaced, (2) what
`platformos-graph` provides today and where it falls short, and (3) the
decision — extend `platformos-graph` (edges + a resurrected project-map / query
layer) and have the supervisor shape that data into `ValidateCodeResult`.

## Context

### What the old supervisor surfaced (recovered from git `f60bc39`)

Two channels:

- A **single-file** `structural` snapshot (the file's own declarations):
  `renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`,
  `translation_keys`, `doc_params`, `slug`, `layout`, `method`. No
  project-relationship data.
- **Cross-file** facts, delivered as diagnostics, powered by a bespoke
  in-supervisor `ProjectFactGraph` + `ProjectMap`:

| Fact | Old source |
|---|---|
| Callers/dependents of a partial | `PartialEntry.rendered_by` reverse-index / `graph.referencedBy` / `dependentsOf` |
| Orphan status (no callers) | `graph.referencedBy().length === 0` / `isOrphan` |
| Outgoing deps (renders / function / graphql) | `renders` / `function_calls` / `graphql_calls` per entry |
| Missing render/function/graphql target | `resolveRenderTarget` / `resolveFunctionTarget` / `resolveGraphqlTarget` + `hasNode` |
| Reachable partials from a file (BFS) | `partialsReachableFrom` |
| Target partial's `@param` signature | `partialSignature` / `getPartialParams` |
| Chain-forwardable param | `isParamAvailableInCallerScope` (render-flow) |
| Variable consumed downstream | `isVariablePassedToRender/Function` (render-flow) |
| Nearest-name "did you mean" (partials, pages, schema props, translation keys) | `nearestByLevenshtein` over typed node sets |
| Resource/CRUD completeness (missing search/create per table) | `detectResources` → `ProjectMap.summary.resources` |

The bespoke `project-fact-graph.ts` / `dependency-graph.ts` / `project-scanner.ts`
/ `render-flow.ts` modules were exactly the "duplicate graph/scanner" the
rebuild set out to eliminate (ANALYSIS.md §6, invariant #3). They should NOT be
rebuilt in the supervisor; their *capabilities* should live in `platformos-graph`.

### What `platformos-graph` provides today (read first-hand, 2026-06-12)

- `AppGraph { rootUri, entryPoints, modules: Record<uri, AppModule> }`. Each
  `AppModule` carries `dependencies: Reference[]` (outgoing), `references:
  Reference[]` (incoming / callers), `kind` (`Page | Partial | Layout`),
  `exists`.
- `Reference = { source: Location, target: Location, type: 'direct' | 'indirect' }`
  — carries **call-site ranges** but **not** the semantic kind (render vs
  function vs graphql) and **no call args**.
- `buildAppGraph(rootUri, deps, entryPoints?)` — entry points default to
  **pages + layouts**; `traverseModule` extracts edges for **only**:
  `{% render 'literal' %}`, asset filters (`asset_url` / `asset_img_url` /
  `inline_asset_content`), and `<custom-element>` web components.
- `getWebComponentMap` / `findWebComponentReferences` — `<custom-element>` ↔
  `customElements.define` linking.

**Hard limits today:**

1. **Render+asset only.** No `{% function %}`, `{% graphql %}`, `{% include %}`,
   or layout-frontmatter edges. Commands/queries/graphql files are largely
   **absent** from `modules` (nothing renders them).
2. **`Reference` has no kind and no args.** Can't distinguish a render edge from
   an asset edge, nor recover the args passed at a call site.
3. **No project-map / query API.** The graph is a data structure (modules with
   edge arrays); there is no `dependentsOf` / `isOrphan` / `partialSignature` /
   nearest-name / resource-completeness layer — and no per-file "self
   structural" extraction.

Already-owned-elsewhere (consume, do not duplicate even inside graph):
frontmatter schema + `slug`/`method`/`layout` validity → `platformos-check-common`
(`frontmatter.ts`, `ValidFrontmatter`); partial `@param` signatures →
check-common `getDocDefinition` / liquid-doc; object/schema properties + docset →
check-common.

## Decision

Apply the consumer principle:

1. **The supervisor re-implements no graph/scanner logic.** It calls
   `platformos-graph`, caches the result at its I/O edge (`lint/`), and feeds
   plain data to pure `enrich/` + `result/` stages that shape
   `ValidateCodeResult.structural`.

2. **Extend `platformos-graph` to cover what we need** (all graph functionality
   lives there):
   - **(A) Traversal edges.** Add `{% function %}`, `{% graphql %}`,
     `{% include %}`, and layout-association edges; include command/query/graphql
     module kinds so they are first-class nodes. (Optionally widen entry points
     so non-render-reachable files still appear.)
   - **(B) A project-map / query layer** — resurrect the old `ProjectMap`
     capabilities *as the graph package's public API*, not in the supervisor:
     `dependentsOf` / `referencedBy`, `isOrphan`, reachability,
     missing-target resolution, render-call args + ranges, nearest-name
     candidate sets, and a resource/CRUD-completeness view. Where a fact is
     already owned by check-common (partial `@param` signatures, frontmatter,
     schema properties, docset), the graph layer **delegates to / composes**
     check-common rather than re-deriving it.
   - **(C) Per-file self-structural** (renders/graphql/filters/tags/slug/layout/
     method/doc_params) exposed per module, so the supervisor does not re-run an
     `extractAllFromAST`. (Owner decision below.)

3. **Consume existing owners.** Frontmatter validity and `@param` signatures
   come from check-common; the docset from check-common. The graph layer and the
   supervisor consume these — neither duplicates them.

4. **Supervisor responsibility is unchanged and narrow:** turn the graph's
   structured project facts into the agent-facing `structural` block + ergonomic
   hints. Nothing graph-related lives in the supervisor.

### Ownership map (target)

| Capability | Owner | Supervisor role |
|---|---|---|
| Dependency edges (render/function/graphql/include/asset/layout) | **platformos-graph** (extend traverse) | consume |
| Dependents / orphan / reachability / missing-target | **platformos-graph** (query API) | consume |
| Render-call args + site ranges | **platformos-graph** (extend `Reference` or query) | consume |
| Resource / CRUD completeness | **platformos-graph** (project-map view) | consume |
| Nearest-name candidate sets | **platformos-graph** (over node names) | consume |
| Per-file self-structural | **platformos-graph** per module *(preferred)* — it already parses every file | consume |
| Partial `@param` signatures | **platformos-check-common** (`getDocDefinition`) | graph + supervisor consume |
| Frontmatter validity, schema properties, docset | **platformos-check-common** | consume |
| Shape facts → `ValidateCodeResult.structural` + hints | **platformos-mcp-supervisor** | owns (ergonomics only) |

## Consequences

- **Positive.** One graph, no parallel scanner (honours invariant #3). The same
  extensions improve the LSP features that already consume `platformos-graph`
  (`platformos_references`, `platformos_dependencies`, `platformos_dead_code`).
  The supervisor stays thin.
- **Cost / blast radius.** Extending `platformos-graph` touches a package the
  language server depends on. Changes are **additive** (more edges, new query
  API) but must be covered by graph-package tests and re-verified against the
  LSP consumers.
- **`Reference` change.** Carrying the edge *kind* (and optionally args) is a
  shared-type change; keep it additive (e.g. an optional `kind` field) so
  existing consumers are unaffected.
- **Phasing.**
  - *Phase 1 (today's graph):* the supervisor can already surface
    render-scoped dependents, orphan-by-render (partials only), missing render
    targets, and asset references — clearly labelled render/asset-scope — plus
    self-structural parsed at the lint edge. Useful but partial.
  - *Phase 2 (extended graph):* full dependents/orphan across
    command/query/graphql, resource completeness, nearest-name — the complete
    project view, all sourced from `platformos-graph`.
- **Anti-goal reminder.** Do not reintroduce `project-fact-graph.ts` /
  `project-scanner.ts` / `render-flow.ts` inside the supervisor. If a capability
  is missing, it is added to `platformos-graph`.

## Open questions

1. **Per-file self-structural owner** — expose per-module on `platformos-graph`
   (it already parses everything) vs a shared extraction util in
   check-common/common? (Recommendation: platformos-graph, since it owns parsing
   the app.)
2. **`Reference.kind`** — add an optional discriminant (`render | include |
   function | graphql | asset | web-component | layout`) to `Reference`, or model
   per-edge metadata another way?
3. **Resource/CRUD completeness** — does this belong in `platformos-graph`
   (project-structure analysis) or a thin separate analysis layer? It is the
   least "pure graph" of the old project-map facts.
4. **Phase 1 now or wait?** Ship render/asset-scoped structural against today's
   graph, or hold the `structural` block until the graph extensions (Phase 2)
   land?
5. **Build cost / freshness** — full-app graph build is parse-heavy; cache at the
   supervisor edge with a TTL (matches v1's 30s) vs explicit invalidation?

## References

- `docs/mcp-supervisor/decisions/002-rebuild-thin-structured-seam/README.md` — the
  structured-seam rebuild this builds on.
- `ANALYSIS.md` §6 (duplicate graph/docset is a mistake), invariant #3 (one graph).
- Old surface recoverable at git `f60bc39`: `src/core/{project-fact-graph,dependency-graph,project-scanner,render-flow}.ts`, `src/tools/validate-code.ts`.
- `packages/platformos-graph/src/{types,graph/build,graph/traverse}.ts` — current model.
