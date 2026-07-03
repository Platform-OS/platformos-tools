---
id: TASK-9.3
title: Expose per-file self-structural facts on platformos-graph modules
status: Done
assignee: []
created_date: '2026-06-23 10:33'
updated_date: '2026-06-30 14:35'
labels: []
dependencies:
  - TASK-9.1
references:
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Expose a file's OWN structural declarations per module so consumers do not re-run an `extractAllFromAST`-style pass. `platformos-graph` already parses every file while building the graph; surface the by-product.

## Facts (the old single-file `ValidateCodeStructuralSnapshot`)
`renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys`, `doc_params`, `slug`, `layout`, `method`.

## Owner decision (ADR 003 open question #1)
Preferred owner is `platformos-graph` (it already parses the app). If parsing/extraction is better placed in a shared check-common/common util, expose it from there and have the graph compose it — but the consumer (supervisor) must get these facts WITHOUT parsing the file itself. Resolve the owner as part of this task and record it in ADR 003.

## Constraints
- Frontmatter-derived facts (`slug`/`method`/`layout`) should reuse check-common frontmatter parsing, not a second parser.
- Additive to the module shape; existing consumers unaffected.

## Out of scope
- Cross-file queries (task-9.2); supervisor result shaping (TASK-8.4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A module's own structural declarations (renders/graphql/filters/tags/translation_keys/doc_params/slug/layout/method) are obtainable from platformos-graph without the consumer parsing the file
- [x] #2 Frontmatter-derived fields reuse check-common parsing (no second frontmatter parser)
- [x] #3 The owner decision (graph vs shared util) is recorded in ADR 003
- [x] #4 Unit pins cover the exposed self-structural for representative file types
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Landed (2026-06-25): per-file dependency primitive — `extractFileReferences`

The outgoing-dependency half of this task is now implemented in `platformos-graph` and integration-ready. Self-structural *names* (filters/tags/translation_keys/doc_params/slug/layout/method) are still TODO under this task; the dependency edges are done.

### API (exported from `@platformos/platformos-graph`)
```ts
extractFileReferences(
  rootUri: UriString,
  sourceUri: UriString,
  sourceCode: FileSourceCode,   // parse the BUFFER via toSourceCode(sourceUri, content)
  deps: { fs: AbstractFileSystem },
): Promise<Reference[]>
```
Returns the file's resolved outgoing edges: `{ source:{uri,range}, target:{uri}, type:'direct', kind }`, `kind ∈ render|include|function|background|graphql|asset`. Target URIs are DocumentsLocator-canonical (lib paths, `modules/<m>/public/...`, `.html.liquid`) and normalized identically to graph node keys (Windows-safe).

### Why this shape (matches the buffer-before-write model)
`validate_code` validates an in-flight buffer that may not be on disk. So the consumer parses the *buffer* (not disk) with `toSourceCode`, and resolution touches `fs` only for target lookup. NO whole-graph build, NO reachability requirement — works for orphan/new files. This is the single resolution path shared with the full `buildAppGraph` traversal (`resolveLiquidReferences` in `graph/traverse.ts`), so per-file and project-wide resolution can never drift.

### Files
- `packages/platformos-graph/src/graph/traverse.ts` — extracted `resolveLiquidReferences` (internal) + public `extractFileReferences`; `traverseLiquidModule` now calls the shared resolver (behavior-identical, verified by unchanged build/traverse-edges specs).
- `packages/platformos-graph/src/index.ts` — exports `extractFileReferences`.
- `packages/platformos-graph/src/graph/extract.spec.ts` — 8 pins incl. in-flight buffer for a file not on disk, all kinds, module-namespaced, dynamic/unparseable/no-ref → `[]`.

### Owner decision (AC #3 — record in ADR 003)
Dependency resolution lives in `platformos-graph` (it owns DocumentsLocator wiring + the kind taxonomy). The remaining self-structural NAME extraction (filters/tags/translation_keys/doc_params/frontmatter slug/layout/method) should reuse check-common's liquid-doc/frontmatter parsing (AC #2) and be composed by the graph — still open.

## Reuse survey + phasing plan (2026-06-30)

Reuse survey (AC#2): check-common exposes NO ready-made extractors for most facts (no exported frontmatter parser — RouteTable.extractFrontmatter is private; no filter/tag/translation extractor). 'Reuse, don't re-derive' here = reuse the PARSERS the graph already runs: liquid-html AST (`toSourceCode`+`visit`), `js-yaml` for frontmatter (same parser RouteTable/the layout-edge use — NOT a bespoke/regex parser), `liquid-doc` (`DocDefinition`/`LiquidDocParameter`) for doc_params, `translation-utils` for keys. The facts are a by-product of the parse the graph already does.

Key risk: a HALF-populated `structural` snapshot would itself MISLEAD the agent (empty `filters_used` reads as 'no filters' vs 'not extracted'). So 9.3 ships COMPLETE, non-misleading subsets per phase — fields are added to the type only as implemented (absent = not-available, never a misleading empty array).

**Mechanism**: a `structural?` property on LiquidModule, populated in `traverseLiquidModule` (full-build) as a by-product. Per-file `extractFileReferences` is unchanged (edges only) for now; surfacing self-structural per-buffer is a later, separate step.

**Phase A (this slice): page routing facts — `slug`, `layout`, `method`.** Reuse: effective slug = frontmatter `slug` override ?? `slugFromFilePath(extractRelativePagePath(uri), formatFromFilePath(...))` (all platformos-common); layout/method from frontmatter via shared `loadFrontmatter` (js-yaml; refactor the layout-edge visitor to share one load helper — single frontmatter-parse code path). Delivers slug (the TASK-9.7 need). Neutral, complete subset.

**Phase B: AST usage facts — `renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys`** (visit the already-parsed AST; renders/graphql can derive from the literal names; translation_keys via translation-utils).

**Phase C: `doc_params`** via check-common liquid-doc (`DocDefinition`/`LiquidDocParameter`).

ADR 003 owner decision (AC#3): extraction lives in platformos-graph as a by-product of its parse, composing check-common parsers (js-yaml, liquid-doc, translation-utils, slug helpers) — to be recorded in ADR 003 when 9.3 completes.

## Phase A DONE (2026-06-30): page routing facts (slug/layout/method)

- **types.ts**: `ModuleStructural { slug?, layout?, method? }` + `LiquidModule.structural?`. Doc'd: ABSENT field = 'not available' (never a misleading empty); AST usage facts added in later phases.
- **traverse.ts**: `extractStructural(sourceCode, uri)` set on each Liquid module in `traverseLiquidModule` (full-build by-product). Reuses: shared `loadFrontmatter` (one js-yaml path — the layout-edge visitor + schemaTableName now share it too) + platformos-common `extractRelativePagePath`/`slugFromFilePath`/`formatFromFilePath`. Effective slug = frontmatter `slug` override (verbatim, coerced like RouteTable) else path-derived; layout/method from frontmatter; returns undefined when none (partials → undefined). `frontmatterBody` grabs the YAMLFrontmatter node O(children), no full re-visit.
- Per-file `extractFileReferences` unchanged (edges only); structural is a full-build node fact for now.

**Tests (thorough variants)**: new `fixtures/structural/` + `structural.spec.ts` (4): path-derived slug + layout + method (index→'/'), no-frontmatter path-derived slug (about→'about'), frontmatter slug OVERRIDE wins over path (blog/show→'blog/custom'), partial→undefined.

**Verification**: graph 71 (additive — no existing full-module assertion broke; serialize/SerializableNode doesn't include structural so cli/serialize unaffected), prettier clean, dist rebuilt, LSP+supervisor type-check clean. Consumer suites running (validate_code must stay byte-identical).

Remaining: Phase B (renders_used/graphql_queries_used/filters_used/tags_used/translation_keys), Phase C (doc_params).

## Phase B DONE (2026-06-30): AST usage facts (renders/graphql/filters/tags/translation_keys)

- **types.ts `ModuleStructural`**: added the 5 usage arrays — `renders_used`, `graphql_queries_used`, `filters_used`, `tags_used`, `translation_keys` — ALWAYS present (sorted + de-duplicated; empty = none used, since the whole AST is analyzed, so no absent-vs-empty ambiguity). `slug`/`layout`/`method` stay optional. Net: `structural` is now present for any parseable Liquid module (undefined only if the AST failed to parse).
- **traverse.ts `extractStructural`**: one `visit` of the already-parsed AST collects renders (RenderMarkup string literal), graphql (GraphQLMarkup string literal), filters (LiquidFilter.name), tags (LiquidTag.name), translation_keys (LiquidVariable with a String expression piped through `t`/`translate` — same detection as the translation-key-exists check). Reuses the existing parse + `isStringLiteral`; no new parser.

**Misleading-output design**: usage arrays always-present (empty=none) is the non-ambiguous choice. This made `structural` present on every Liquid node, which broke 5 edge-test full-node assertions (they pinned the whole TARGET node, now carrying empty-usage structural). Fix per separation-of-concerns + the repo guideline's 'don't over-pin an internal payload' exception: added `edgeIdentity()` to traverse-edges.spec that strips `structural` from the compared node — edge tests assert EDGE identity; structural is pinned exhaustively in structural.spec. Keeps edge tests stable as structural grows (Phase C doc_params won't re-break them).

**Tests (thorough variants)**: structural.spec rewritten (5): index (path slug '/' + layout + method + its one render/tag), about (path slug, all-empty usage), blog/show (slug override), card partial (all-empty, no routing), rich.liquid (full: renders ['card'], graphql ['blog/find'], filters ['t','upcase'], tags ['assign','graphql','if','render'], translation ['greeting.hello'], slug 'rich', layout) — verified actuals match the parser. Graph suite 72 pass.

**Verification**: graph 72, type-check + prettier clean, dist rebuilt, LSP+supervisor type-check clean. Consumer suites running (validate_code byte-identical expected).

Remaining: Phase C (doc_params via liquid-doc), then record ADR-003 owner decision + close 9.3.

## Phase C DONE + TASK-9.3 CLOSED (2026-06-30): doc_params, all 9 facts complete

- **types.ts**: `ModuleStructural.doc_params: string[]` (always present, source/declaration order).
- **traverse.ts `extractStructural`**: populated via check-common `extractDocDefinition(uri, ast)` → `liquidDoc.parameters[].name` — REUSE of the owned liquid-doc parser, no second parser. (`{% doc %}` is a LiquidRawTag so it correctly does NOT appear in tags_used.)
- **structural.spec**: +1 (`documented.liquid` → doc_params ['title','count'] in declaration order); `NO_USAGE` + rich/index updated for the new always-present array. Graph suite 73.

**ADR 003 owner decision (AC#3) RECORDED**: self-structural lives on `platformos-graph` LiquidModule.structural as a parse by-product, COMPOSING check-common parsers (extractDocDefinition, shared js-yaml loadFrontmatter, AST visit, translation t/translate detection, slug helpers) — never re-deriving. Resolved ADR 003 open questions #1 (owner=graph), #2 (Reference.kind/args), #3 (resource/CRUD → ADR 004, out of graph).

## Final verification (all 9 facts: slug/layout/method + renders_used/graphql_queries_used/filters_used/tags_used/translation_keys/doc_params)
- graph **73**, supervisor **50** (validate_code byte-identical — structural is a full-build node fact, invisible to the per-file extractFileReferences path), LSP **466/467** (only the pre-existing TypeSystem timeout flake). All packages type-check clean; prettier clean; dists rebuilt.
- AC#1 (all facts obtainable without re-parsing) ✓, AC#2 (reuse check-common parsing, no second parser) ✓, AC#3 (owner recorded in ADR 003) ✓, AC#4 (unit pins for representative file types: page/partial/documented/rich) ✓.

Note: the supervisor surfacing `structural` in validate_code output is separate (TASK-8.4 result shaping), not part of 9.3. Closing as Done.
<!-- SECTION:NOTES:END -->
