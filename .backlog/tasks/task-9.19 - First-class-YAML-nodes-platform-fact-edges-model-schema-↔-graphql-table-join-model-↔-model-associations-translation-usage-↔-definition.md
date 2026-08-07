---
id: TASK-9.19
title: >-
  First-class YAML nodes + platform-fact edges: model/schema ↔ graphql (table
  join), model ↔ model (associations), translation usage ↔ definition
status: To Do
assignee: []
created_date: '2026-07-03 06:51'
updated_date: '2026-08-07 14:49'
labels:
  - platformos-graph
  - mcp-supervisor
  - architecture
  - yaml
  - translations
  - schemas
dependencies: []
references:
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/types.ts
  - packages/platformos-common/src/translation-provider/TranslationProvider.ts
  - packages/platformos-check-common/src/schema-table.ts
  - packages/platformos-check-common/src/graphql-table.ts
  - packages/platformos-check-common/src/translation-usage.ts
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - docs/mcp-supervisor/decisions/004-platform-facts-vs-conventions
parent_task_id: TASK-9
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WHY. Standalone `.yml` is currently NOT relational in the graph: `SchemaModule` (CustomModelType) is a leaf discovered only on a FULL build (the supervisor's scoped cache never materializes it), and translation `.yml` are not nodes at all. So `validate_code` correctly but bluntly returns `not_applicable` for them (the #1 review fix). This task makes `.yml` first-class by modeling the platform-FACT relationships that connect them — deterministic, syntax/mechanics-driven links, NOT naming conventions.

SCOPE BOUNDARY (ADR 004). IN scope = facts driven by platform syntax/mechanics. OUT of scope = the commands/queries resource/CRUD convention (naming patterns) → that stays TASK-9.7. The line: a `.graphql` `table:` filter, a schema-declared `belongs_to`, and the `t`/`translate` filter + locale resolution are platform mechanics (facts); "app/lib/commands/<model>/create operates on <model>" is a convention.

THE THREE FACT EDGES (all name/reference-based, static, deterministic — same safety class as render/graphql edges):
 A. GraphQL op → model schema (TABLE-NAME JOIN). `extractGraphqlTable` and `extractSchemaTable` ALREADY extract `.table` on both node types; build a `table → schema node` index during the build and link each GraphQLModule to its schema. A JOIN, not path resolution. Highest value, seam already exists.
 B. Model → model (ASSOCIATIONS). Schemas declare `belongs_to`/`has_many`/related-model (148 `belongs_to:` in marketplace-dcra) — schema-declared facts → schema↔schema edges. Needs a small association extractor (extend schema-table.ts into a schema extractor; reuse the shared js-yaml parse).
 C. Translation usage → definition. Usage is ALREADY captured (`isTranslationKeyUsage` → `translation_keys`); the missing half is resolving the key to the `.yml` that defines it and adding the edge. REUSE platformos-common `TranslationProvider.findTranslationFile(rootUri, key, defaultLocale)` — do NOT reinvent locale/module resolution. (defaultLocale: resolve from project config, else 'en' — design detail.) Complements the existing `translation-key-exists` lint (forward "does the key exist"); the graph adds the BACKWARD view (who uses a key) + orphaned-key detection — same relationship as lint-vs-blast-radius.

PREREQUISITE / COORDINATION (the honest blocker). These files must become graph nodes AND enter the fingerprint domain, or edits won't reconcile:
 - `build.ts`: materialize schema + translation nodes in scoped/entry-point builds (not only full builds), and materialize the three edges.
 - GraphCache fingerprint domain (currently `isEdgeSource` = layout|page|partial) must EXPAND to include schema + translation `.yml` so editing one triggers reconcile — coordinate with TASK-9.17 (single owner of the edge-source/source-root definition) and TASK-9.15 (fingerprint domain). Expanding the domain changes what counts as a rebuild/reconcile trigger; verify never-stale + the Phase-3A scoped-walk still hold.
 - `applyFileChange` (TASK-9.14) must handle `.yml` add/modify/delete for the new node/edge types (today a `.yml` change is a no-op).
 - `impact.ts` `isGraphTrackable`: schema + translation `.yml` become trackable → `validate_code` flips them from `not_applicable` to `computed` with real dependents ("edit this model → 12 queries + 3 pages depend on it"). Update the #1 guard + its tests accordingly.

REUSE (verified): `TranslationProvider.findTranslationFile` (key→file), `extractGraphqlTable`/`extractSchemaTable`/`isTranslationKeyUsage` (all exported from check-common), `getFileType`/CustomModelType classification, the shared js-yaml parse, the never-stale cache + `dependentsOf`/query API (downstream free). NOTE: `DocumentsLocator` has NO schema/translation DocumentType — schema linking is the table-join, translation linking is TranslationProvider; do not force these through DocumentsLocator.

ADR 003: all node/edge/resolution logic lives in platformos-graph; the supervisor stays a pure consumer.

Suggested phasing (each shippable, TDD): Phase A (graphql↔schema table join — highest value, seams exist) → Phase B (translation usage↔definition, who-uses-key + orphans) → Phase C (model↔model associations). Instance-profile/transactable types (legacy) are OPTIONAL follow-ons via the same schema mechanism.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Phase A: GraphQL ops are edge-linked to their model schema by table-name join (op.table === schema.table, both via existing extractors); dependentsOf(schema) returns the ops/files that query it; a table with no schema is a missing-target
- [ ] #2 Phase B: translation-key usages are edge-linked to the .yml that defines the key via TranslationProvider.findTranslationFile (no reinvented resolution); dependentsOf(translation) = who uses keys it defines; orphaned keys (defined, never used) are queryable
- [ ] #3 Phase C: schema belongs_to/has_many associations produce schema↔schema edges via a small association extractor reusing the shared js-yaml parse
- [ ] #4 Schema + translation .yml are graph NODES and are in the fingerprint domain (coordinated with TASK-9.17 / 9.15); editing one triggers a never-stale reconcile; scoped-walk (Phase-3A) + never-stale invariants preserved
- [ ] #5 applyFileChange (TASK-9.14) handles .yml add/modify/delete for the new node/edge types; equivalence-to-full-build invariant extended to cover them
- [ ] #6 impact.ts isGraphTrackable includes schema + translation .yml → validate_code returns computed (with real dependents) instead of not_applicable for them; the #1 guard + tests updated
- [ ] #7 Strictly platform FACTS only (ADR 004); the commands/queries resource/CRUD CONVENTION remains out of scope (TASK-9.7); all logic in platformos-graph (ADR 003)
- [ ] #8 TDD: fixtures covering schema/graphql/translation edges; edge + dependents + orphan + reconcile assertions (whole-value); graph + supervisor suites + type-check + format + frozen-lockfile green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## STALENESS CHECK 2026-08-07 — the NODES landed; none of the three edges did

**What is done:** schema/YAML files are first-class graph nodes. `SchemaModule`
(`platformos-graph/src/types.ts:162`) exists with `kind: 'schema'` and carries
`table?: string`, delivered by TASK-9.6 (archived Done). `GraphQLModule` carries
`tables`. So both sides of the Phase-A join now hold the data the join needs.

**What is NOT done — all three edge families, Phase A included.** The raw material
exists but nothing links it. `SchemaModule.table`'s own doc says it is "a single value …
that **a consumer** can join against", i.e. the join is deliberately left to the caller
and there is no `table → schema` index or edge in the build. So AC #1's real requirement
— "`dependentsOf(schema)` returns the ops/files that query it" — is unmet, as are Phase B
(translation usage ↔ definition) and Phase C (model ↔ model associations).

So retitle rather than re-scope: "First-class YAML nodes" is finished, "platform-fact
edges" is entirely outstanding.

**Two constraints worth carrying into the work:**

1. `SchemaModule`'s doc records that it is "not render-reachable, so it is discovered and
   added explicitly during a full `buildAppGraph` (never an entry point)". That is exactly
   the prerequisite this task's description flags — scoped/entry-point builds must
   materialize these nodes, or edits will not reconcile.
2. For Phase B, use check-common's exported `isTranslationKeyUsage` / `TRANSLATION_FILTERS`
   rather than a fresh predicate. They are exported specifically "so the graph's
   self-structural detects translation keys with the SAME rule as the
   `TranslationKeyExists` check" — the difference between the graph and the check agreeing
   about what a translation reference is and quietly disagreeing.
<!-- SECTION:NOTES:END -->
