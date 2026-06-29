---
id: TASK-9.1
title: >-
  Extend graph traversal: function/graphql/include/layout edges + first-class
  command/query/graphql nodes
status: Done
assignee:
  - filip
created_date: '2026-06-23 10:32'
updated_date: '2026-06-24 11:12'
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
labels: []
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-graph/src/types.ts
modified_files:
  - packages/platformos-check-common/src/types.ts
  - packages/platformos-graph/src/types.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/graph/build.spec.ts
  - packages/platformos-graph/src/graph/traverse-edges.spec.ts
  - packages/platformos-graph/package.json
  - packages/platformos-graph/fixtures/function-edges
  - packages/platformos-graph/fixtures/graphql-edges
  - packages/platformos-graph/fixtures/include-edges
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal
Make `platformos-graph` model the dependency edges it currently misses, so dependents/orphan/reachability are complete for every platformOS file type — not just render-reachable partials.

## Today
`traverseModule` (src/graph/traverse.ts) extracts only `{% render 'literal' %}`, asset filters (`asset_url`/`asset_img_url`/`inline_asset_content`), and `<custom-element>` edges. Entry points (src/graph/build.ts) are pages+layouts. Commands/queries/graphql files are therefore largely ABSENT from `modules`.

## Scope
- Extend `traverseLiquidModule` to emit edges for `{% function %}` (→ lib commands/queries), `{% graphql %}` (→ graphql operation files), `{% include %}` (legacy partial), and layout-frontmatter association (page/email → its `layout`).
- Ensure the targets become first-class modules (extend `getModule`/module kinds + entry-point discovery as needed so command/query/graphql files appear in `modules`).
- Add an OPTIONAL `kind` discriminant to `Reference` (e.g. `render | include | function | graphql | asset | web-component | layout`) so consumers can tell edge types apart — additive, must not break existing consumers.
- Handle dynamic (non-string) render/function targets gracefully (skip or mark indirect).

## Out of scope
- The query/project-map API (task-9.2) and per-file self-structural (task-9.3).

## Constraints
- Additive only; re-verify the LSP consumers (`platformos_references`/`dependencies`/`dead_code`).
- Reuse check-common path resolution (DocumentsLocator / file-type) for target resolution; do not hand-roll path logic that check-common owns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 traverseModule emits function, graphql, and include edges; command/query/graphql targets are first-class modules in the graph (layout-association edges split out to TASK-9.4)
- [x] #2 Reference carries an optional, additive `kind` discriminant; existing consumers compile and pass unchanged
- [x] #3 Target resolution reuses check-common (DocumentsLocator/file-type), not bespoke path logic
- [x] #4 Graph unit tests pin the new edge kinds; LSP references/dependencies/dead_code re-verified green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Analysis (2026-06-23, first-hand)
- Graph today: `traverseModule` emits only RenderMarkup (`{% render 'literal' %}`), asset-filter, and `<custom-element>` edges. Entry points = pages+layouts. `bind()` builds `Reference{source,target,type}` and pushes to `source.dependencies` + `target.references`.
- Parser hooks (confirmed in liquid-html-parser stage-2-ast.ts): `FunctionMarkup.partial: LiquidString|LiquidVariableLookup` (mirrors `RenderMarkup.partial`); `GraphQLMarkup.name: string` (external op; `GraphQLInlineMarkup` = inline, no file). All are distinct NodeTypes → usable as visitor keys.
- Canonical resolver: `DocumentsLocator.locate(rootUri:URI, DocumentType, fileName)` (async, disk-probing, handles module prefixes + extensions). DocumentType already includes 'function'|'render'|'include'|'graphql'|'asset'. NOT re-exported by check-common → requires adding `@platformos/platformos-common` as a graph dep.
- `Reference` is defined in check-common (`types.ts:318`) and re-exported by graph. Adding `kind` is an additive check-common change (consumed by LSP + checks; optional → safe).
- Structural gap: `ModuleType` = Liquid|Asset only → `.graphql` files have NO module type → graphql edges need a new `ModuleType.GraphQL` (Phase 3).
- `getModule(uri)` is only reached for entry points (pages/layouts); its isPartial/asset branches are effectively dead. `getPageModule(uri)` already creates a module from a FULL uri → mirror it for function targets (`getPartialModuleByUri`) instead of the name-rebuilding `getPartialModule`.

## Phased plan (TDD; each phase ≤5 files; verify + pause between)
- **Phase 1 — `Reference.kind` + tag existing edges.** check-common `types.ts`: add `ReferenceKind` union + optional `kind?` on `Reference`. graph `traverse.ts`: pass `kind` to `bind()` for existing render/asset/web-component edges. Spec asserts existing edges carry kind. Additive, zero behaviour change. (~3 files)
- **Phase 2 — function-call edges.** Add `@platformos/platformos-common` dep (package.json + tsconfig + tsconfig.build). `traverse.ts`: `FunctionMarkup` visitor → resolve via `DocumentsLocator('function')` → bind kind 'function'. `module.ts`: `getPartialModuleByUri`. Fixture + spec (used query gets a reference; missing target → exists:false). 
- **Phase 3 — graphql edges.** New `ModuleType.GraphQL` (+ kind) in graph types; `GraphQLMarkup` visitor → resolve `DocumentsLocator('graphql')` → bind kind 'graphql'. Fixture + spec.
- **Phase 4 — include tagging + layout-association edges.** Confirm `{% include %}` node handling; layout edge from page/email frontmatter `layout` (extension/default/`false` handling). Fixture + spec.

## Resolution strategy (per AC#3)
Reuse `DocumentsLocator` (canonical, async, handles module/extension/marketplace_builder/search-paths). Use `locate` for real targets; for missing targets create an `exists:false` node via `locateDefault`/convention so broken function/graphql refs are still surfaced (parity with current render behaviour).

## Verification per phase (forced)
`yarn workspace @platformos/platformos-graph test` + `type-check`; `yarn workspace @platformos/platformos-check-common type-check` + tests; build + type-check the LSP consumer (`platformos-language-server-common`) to honour AC#4 (additive, no regression); prettier. eslint if configured.

## Out of scope here
Query/project-map API (TASK-9.2), per-file self-structural (TASK-9.3), widening entry points to enumerate all command/query/graphql files (decide in 9.2 where dead-code is computed).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Phase 1 DONE (2026-06-23) — Reference.kind + tag existing edges
- check-common `types.ts`: added `ReferenceKind` union (render|include|function|graphql|asset|web_component|layout) + optional `kind?` on `Reference` (additive). check-common rebuilt so dist .d.ts carries it.
- graph `types.ts`: re-export `ReferenceKind`. graph `traverse.ts`: `bind()` accepts+sets `kind`; visitor tags existing edges — LiquidFilter→'asset', HtmlElement→'web_component', RenderMarkup→'include' (when parent tag is include) else 'render'. Narrowed `tag.name` via `tag.type === NodeTypes.LiquidTag`.
- TDD: build.spec asserts existing render+asset edges carry kind (red→green).
- Verified: graph 8/8, check-common 1037/1037, LSP consumer (language-server-common) 465/465 + type-check clean (AC#4 additive, no regression). Prettier clean.
Files: check-common/src/types.ts, graph/src/types.ts, graph/src/graph/traverse.ts, graph/src/graph/build.spec.ts.

## Phases 2-3 + include DONE (2026-06-23); layout remaining

**Phase 2 — function edges.** Added `@platformos/platformos-common` dep. `traverse.ts` `FunctionMarkup` visitor resolves the target (`node.partial.value`) via `DocumentsLocator.locateOrDefault(rootUri,'function',name)` → `getPartialModuleByUri` (module.ts, full-uri Partial module) → bind kind 'function'. Missing target → locateDefault → exists:false node. Fixture `fixtures/function-edges` + 3 specs (used query gets a reference; missing→exists:false; edge kind).

**Phase 3 — graphql edges.** New `ModuleType.GraphQL` + `GraphQLModule` (leaf, kind 'graphql') in graph types; `traverseModule` GraphQL leaf-case. `GraphQLMarkup` visitor resolves the OPERATION FILE via `node.graphql.value` (NOT `node.name`, which is the result var — caught by a failing test) through `DocumentsLocator('graphql')` → `getGraphQLModuleByUri` → bind kind 'graphql'. Fixture `fixtures/graphql-edges` + 3 specs.

**Phase 4a — include.** `{% include %}` already produces a RenderMarkup node (parent tag 'include'); Phase 1 tagging already emits kind 'include'. Pinned with `fixtures/include-edges` + 1 spec.

**Verification:** graph 14/14 (incl. 7 edge specs), check-common 1037, LSP consumer (language-server-common) full suite — 1517 tests total across the three packages, no regressions. graph + check-common + LSP type-check clean; graph build clean; prettier clean. AC#4 honoured (additive; LSP consumers green).

**Demonstration (real salvage fixture):** modules 9→14, edges 5→10. Previously-invisible `app/lib/queries/*` + `app/graphql/blog_posts/*` now first-class with references; `list.liquid`→search-query function edge recorded (was false negative); broken `products/search` graphql ref surfaced as exists:false. The function/graphql/orphan false-positives/negatives from the earlier analysis are fixed for those edge kinds.

**REMAINING — layout-association edges (AC#1).** `YAMLFrontmatter` node carries `body` (YAML text); a visitor must parse `layout` and bind a 'layout' edge page→layout. Blocker/decision: `DocumentsLocator` has NO 'layout' DocumentType (only render/include/function/graphql/asset/theme_render_rc). Per the reuse principle (no bespoke path logic), the right move is to ADD a 'layout' DocumentType to `DocumentsLocator` in platformos-common (additive: new enum value + locateFile/locateDefault cases using FILE_TYPE_DIRS[Layout]; handles .liquid/.html.liquid + module prefixes; benefits the LSP too), then the graph resolves via `DocumentsLocator('layout')`. Lower value than function/graphql (layouts are already entry-point nodes). Left for the next slice.

Note: commands only reachable via other commands (not from any page/layout) still don't appear — that's the entry-point-enumeration concern deferred to TASK-9.2 (dead-code).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended platformos-graph to model function, graphql, and include dependency edges (layout-association split to TASK-9.4). Done TDD, in phases, each verified.

**Reference.kind (check-common, additive):** added `ReferenceKind` union (render|include|function|graphql|asset|web_component|layout) + optional `kind?` on `Reference`. Existing render/asset/web-component edges tagged; `{% include %}` (already a RenderMarkup node under an include tag) tagged `include`.

**function edges:** `FunctionMarkup` visitor resolves `node.partial.value` via `DocumentsLocator.locateOrDefault(rootUri,'function',name)` → `getPartialModuleByUri` (full-uri Partial module) → bind kind `function`. Missing target → exists:false node. Added `@platformos/platformos-common` dep.

**graphql edges:** new `ModuleType.GraphQL` + `GraphQLModule` (leaf, kind 'graphql') + `traverseModule` leaf-case. `GraphQLMarkup` visitor resolves the operation FILE via `node.graphql.value` (a failing test caught that `node.name` is the result variable, not the file) through `DocumentsLocator('graphql')` → `getGraphQLModuleByUri` → bind kind `graphql`.

**Resolution** goes entirely through check-common's `DocumentsLocator` (no bespoke path logic, AC#3); missing targets surface as exists:false (parity with render).

**Tests:** build.spec (existing edges carry kind) + traverse-edges.spec (7: function ×3, graphql ×3, include ×1) over dedicated fixtures function-edges/graphql-edges/include-edges.

**Verification:** graph 14/14; check-common 1037/1037; LSP consumer (language-server-common) full suite green — 1517 tests total across the three packages, zero regressions. graph + check-common + LSP type-check clean; graph build clean; prettier clean. AC#4 honoured (additive; LSP consumers green).

**Demonstration (real salvage fixture):** modules 9→14, edges 5→10. Previously-invisible `app/lib/queries/*` (function) + `app/graphql/blog_posts/*` (graphql) are now first-class nodes with references; `list.liquid`→search-query function edge recorded (was a false negative); the test page's broken `products/search` graphql ref now surfaces as exists:false. The function/graphql orphan/dependency false-positives and false-negatives from the earlier analysis are fixed.

**Layout** (the 4th edge) split to TASK-9.4 as a small cross-package PR (needs a new `'layout'` DocumentType in platformos-common + frontmatter visitor + missing-content-for-layout Layout-type delegation). Note: commands reachable only from other commands (not from any page/layout entry point) still don't appear — deferred to TASK-9.2 (dead-code/entry-point enumeration).
<!-- SECTION:FINAL_SUMMARY:END -->
- [ ] #1 traverseModule emits function, graphql, include, and layout-association edges; targets are first-class modules in the graph
- [ ] #2 Reference carries an optional, additive `kind` discriminant; existing consumers compile and pass unchanged
- [ ] #3 Target resolution reuses check-common (DocumentsLocator/file-type), not bespoke path logic
- [ ] #4 Graph unit tests pin the new edge kinds; LSP references/dependencies/dead_code re-verified green
<!-- AC:END -->
