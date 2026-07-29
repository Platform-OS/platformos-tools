---
id: TASK-9.6
title: >-
  Model platform facts in platformos-graph: schema/CustomModelType nodes +
  graphql table + page slug
status: Done
assignee: []
created_date: '2026-06-30 11:30'
updated_date: '2026-06-30 12:15'
labels: []
dependencies: []
references:
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/types.ts
parent_task_id: TASK-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why
Resource/CRUD completeness (old `detectResources`) needs three facts the AppGraph does not model today. Per ADR 004, only the PLATFORM-TRUTH subset belongs in the graph; the core-module commands/queries convention does NOT (that is TASK-9.7). This task adds the neutral platform facts so a convention layer can later compose them.

## Platform facts to model (neutral, always-true — NO convention)
1. **Schema / CustomModelType as first-class graph nodes.** Custom model types ARE a platformOS primitive (`PlatformOSFileType.CustomModelType`; dirs `custom_model_types`/`model_schemas`/`schema`). Model them as graph modules with their table name. Decide table-name source: file basename vs. parsed `name:` — reuse check-common frontmatter/YAML parsing, do NOT hand-roll.
2. **A graphql op's `table`** on `GraphQLModule` (platform GraphQL concept; old scanner regex-parsed `table: { value: "..." }`). Prefer reusing any existing check-common graphql parsing over a bespoke regex.
3. **Page `slug`** (frontmatter — platform). Coordinate with TASK-9.3 (per-file self-structural) to avoid duplicate frontmatter parsing; reuse check-common.

## Hard constraints (ADR 004)
- NEUTRAL ONLY. Do NOT add command/query kinds, pluralize, resource grouping, or CRUD expectations — those are convention (TASK-9.7).
- Additive to types/build/traverse; re-verify LSP consumers (references/dependencies/dead_code) + check-common stay green. Changes to shared types additive.
- Reuse check-common (frontmatter, schema, graphql parsing, docset); compose, never re-derive.
- Decide entry-point inclusion: schema files are not render-reachable, so buildAppGraph must include them as nodes deliberately (mirror how pages/layouts are discovered) without breaking existing reachability/orphan semantics.

## Out of scope
- The commands/queries convention + resource/CRUD completeness map/warnings (TASK-9.7).
- Supervisor-side shaping (consumes the finished graph after this lands).

## References
- ADR docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions/README.md
- Old shape: pos-mcp src/core/project-scanner.js detectResources (git f60bc39)</parameter>
<parameter name="acceptanceCriteria">["platformos-graph models schema/CustomModelType files as neutral graph nodes carrying their table name; included in buildAppGraph without breaking existing reachability/orphan semantics", "GraphQLModule exposes its `table` (when declared), sourced by reusing check-common graphql parsing rather than a bespoke regex where possible", "Page modules expose `slug` from frontmatter, reusing check-common parsing (coordinated with TASK-9.3, no duplicate parser)", "NO convention is introduced: no command/query kinds, no pluralize, no resource grouping, no CRUD expectations (enforced by review against ADR 004)", "Additive; graph + check-common + LSP consumers re-verified green; type-check + prettier clean; each new fact has unit pins"]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 platformos-graph models schema/CustomModelType files as neutral graph nodes carrying their table name; included in buildAppGraph without breaking existing reachability/orphan semantics
- [x] #2 GraphQLModule exposes its `table` (when declared), sourced by reusing check-common graphql parsing rather than a bespoke regex where possible
- [x] #3 Page `slug` is MOVED to TASK-9.3 (it is a self-structural fact in 9.3's list and needs 9.3's per-file module-property mechanism + shared frontmatter parse; doing it here would duplicate/pre-empt 9.3). Not in 9.6 scope.
- [x] #4 NO convention is introduced: no command/query kinds, no pluralize, no resource grouping, no CRUD expectations (enforced by review against ADR 004)
- [x] #5 Additive; graph + check-common + LSP consumers re-verified green; type-check + prettier clean; each new fact has unit pins
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Sub-phase plan (2026-06-30) — investigation findings + sequencing

The three platform facts are NOT uniformly 'additive'; investigation found two catches, so 9.6 is delivered as three independently-verified slices in this order:

**Slice 1 — graphql `table` (SAFEST, first).** Optional field on `GraphQLModule` (a leaf node that only exists via edges → ZERO orphan impact; no TASK-9.3 overlap). Only cost: graphql-AST extraction of the platformOS `table` filter — reuse check-common graphql parsing (graphql-variables check already parses graphql), NOT the old fragile regex `table:\s*(?:\{\s*value:\s*"(\w+)"|"(\w+)")`.

**Slice 2 — schema/CustomModelType nodes (needs care).** FINDING: a schema file has no incoming render edges, so the Phase-1 `isOrphan` would WRONGLY flag every schema as dead code. So this slice MUST add an explicit, tested guard excluding non-render node kinds from orphan detection (touches shipped query.ts behavior — deliberate, not additive). New `ModuleType.Schema` (blast radius is contained: only `traverseModule`'s switch + `assertNever` over ModuleType, which compile-forces handling; LSP does NOT switch on ModuleType). Table name from YAML `name:` (old scanner used `parsed.name`; reuse js-yaml, already a graph dep). Build-time discovery: schema files aren't render-reachable, so buildAppGraph must add them as standalone nodes.

**Slice 3 — page `slug` (coordinate with TASK-9.3).** FINDING: graph traversal currently only produces EDGES (`bind`), never module PROPERTIES (beyond `exists`); `slug` is a self-structural property = TASK-9.3's domain. Reuse `extractRelativePagePath` + `slugFromFilePath` + `formatFromFilePath` (exported from platformos-common) for the path-derived slug; frontmatter `slug:` override = effective slug (RouteTable's `extractFrontmatter` is private — not reusable). Do this WITH/INSIDE TASK-9.3 to establish the module-self-structural mechanism once, avoiding the duplicate-parser the AC#3 warns against.

Each slice: TDD, additive where possible, cross-package re-verified (graph + check-common + LSP), type-check + prettier clean before the next.

## Slice 1 DONE (2026-06-30): graphql `table` — AC#2 ✓

- **check-common**: new `src/graphql-table.ts` `extractGraphqlTable(content) -> string | undefined` — AST-based via the `graphql` parser this package already owns (reuses `parse`+`visit` from graphql/language; NOT the old fragile regex). Handles `table: { value: "x" }` + `table: "x"` shorthand, first-wins, namespaced names; returns undefined for dynamic `$var` table values (never records a bogus table), `table:` used as a GraphQL alias, no-table ops, and unparseable input. Exported from the package index (parity with getPosition/levenshtein).
- **graph**: `GraphQLModule.table?: string` (additive optional). Populated in `traverseModule`'s GraphQL leaf branch by reading the resolved op's source once (via deps.getSourceCode) and calling `extractGraphqlTable`. Only set on existing ops (exists:false targets are never read → no table). The per-file `extractFileReferences` primitive is unaffected (it doesn't traverse targets) — table is a full-build node fact, which is what TASK-9.7 needs.
- NEUTRAL: no convention introduced (ADR 004). SerializableNode intentionally left unchanged (table is an in-memory node fact for the query/overlay layer; serialize is the CLI surface — additive later only if needed).

**Tests (thorough, many variants)**: `graphql-table.spec.ts` 13 unit variants (object-form, shorthand, mutation/record_create, deep nesting, order-independence, namespaced, sibling-`value` non-confusion, dynamic-`$var`→undefined, alias-`table:`→undefined, malformed, empty). `traverse-edges.spec.ts` +2 build-time integration (new `fixtures/graphql-table/`: with_table→'blog_post', without_table→undefined) + updated the existing graphql-edges assertion (find.graphql now carries table 'blog_post').

**Verification**: graph 63, check-common type-check clean + spec green, graphql-table 13, prettier clean, dists rebuilt; LSP + supervisor type-check clean. Consumer suites (check-common + LSP) running for final confirmation.

Remaining: Slice 2 (schema nodes + orphan guard), Slice 3 (page slug, with TASK-9.3).

## Slice 2 DONE (2026-06-30): schema/CustomModelType nodes — AC#1 ✓ (AC#4 holds)

- **types.ts**: new `ModuleType.Schema` + `SchemaModule { kind:'schema', table? }` added to the `AppModule` union. `table` = the model name (YAML `name:`), named to align with `GraphQLModule.table` so TASK-9.7 can join op→schema.
- **module.ts**: `getSchemaModule(graph, uri)` factory (normalizes URI, mirrors getGraphQLModuleByUri).
- **traverse.ts**: `traverseModule` gains a `ModuleType.Schema` leaf case (reads source once, sets `table` via new `schemaTableName()` — a top-level YAML `name:` read using js-yaml, the parser already used for frontmatter here; not a bespoke parser). `assertNever` compile-confirmed the case is handled.
- **build.ts**: on a FULL build only (entryPoints undefined), discovers schema files (`getFileType(uri)===CustomModelType` over `.yml`/`.yaml`, reusing check-common classification) and adds them as standalone leaf nodes via `getSchemaModule`+`traverseModule`. NOT entry points — so render reachability/orphan semantics are untouched. Explicit-entryPoints (scoped/LSP) builds are byte-unchanged.
- **query.ts `isOrphan`**: added a guard — `ModuleType.Schema` is NEVER an orphan (schemas are referenced by table name from graphql/commands, not by file edges, so 'no incoming edges' is meaningless for them). Prevents the false-positive dead-code flag the Phase-1 semantics would otherwise produce.
- NEUTRAL (ADR 004): only the platform fact (the schema file + its table name) is modeled; NO commands/queries convention, pluralize, grouping, or CRUD expectations.

**Blast radius (verified minimal)**: the only exhaustive switch over ModuleType is `traverseModule` (handled; assertNever-guarded). No `dead_code` impl exists anywhere (only Phase-1 query.ts, now guarded). SerializableNode = Pick<...'kind'|'exists'> — schema nodes serialize fine, `table` intentionally not in SerializableNode (in-memory node fact for the query/overlay layer).

**Tests (thorough)**: new `fixtures/schema-nodes/` (page + blog_post.yml with name + no_name.yml without). traverse-edges.spec +3 (schema node with table='blog_post'; no-name→table undefined; schema NOT an entry point). query.spec +1 (schema never orphan) + strengthened orphans() to assert schema excluded. Graph suite 67 pass.

**Verification**: graph 67, all four packages type-check clean, prettier clean, dist rebuilt. Supervisor + LSP suites running (validate_code must stay byte-identical; only pre-existing TypeSystem timeout expected in LSP).

Remaining: Slice 3 (page slug, folded into TASK-9.3).

## Re-scoped + CLOSED (2026-06-30): slice 3 (page slug) moved to TASK-9.3

Decision: page `slug` is one of TASK-9.3's listed self-structural facts (renders/graphql/filters/tags/translation_keys/doc_params/**slug**/**layout**/**method**) and needs 9.3's general per-file module-property extraction mechanism + the single shared frontmatter parse (9.3 AC#2: 'no second parser'). Implementing slug standalone in 9.6 would either duplicate that or be ripped out when 9.3 lands. So slug migrates to TASK-9.3.

TASK-9.6 delivered the two genuinely-9.6 NEUTRAL platform facts (ADR 004): graphql `table` (slice 1) + schema/CustomModelType nodes (slice 2). Both shipped, tested, cross-package green: graph 67, check-common 1047, supervisor 50 (validate_code byte-identical), LSP 467/467; type-check + prettier clean; dists rebuilt. AC#3 reframed as 'moved to 9.3'. Closing as Done.
<!-- SECTION:NOTES:END -->
