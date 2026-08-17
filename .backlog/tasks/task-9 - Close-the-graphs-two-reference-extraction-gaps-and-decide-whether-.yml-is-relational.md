---
id: TASK-9
title: >-
  Close the graph's two reference-extraction gaps, and decide whether .yml is
  relational
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
updated_date: '2026-08-16 19:26'
labels:
  - platformos-graph
  - mcp-supervisor
  - edges
  - correctness
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-check-common/src/checks/missing-partial/index.ts
  - packages/platformos-common/src/documents-locator/DocumentsLocator.ts
  - packages/platformos-mcp-supervisor/src/impact/impact.ts
  - packages/platformos-mcp-supervisor/SUPERVISOR-GRAPH-INTEGRATION.md
  - >-
    docs/mcp-supervisor/decisions/003-graph-backed-structural-enrichment/README.md
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## The original epic is DONE; this is what is left

TASK-9 was "extend platformos-graph to own the project structural/dependency model the supervisor consumes". That goal is met: the graph models render/include/function/background/graphql/asset/layout edges with kinds and args, exposes a query API (`dependentsOf`/`dependenciesOf`/`orphans`/`missingTargets`/`nearestModules`), composes check-common's facts rather than re-deriving them, and the supervisor consumes `extractFileReferences` while owning no edge resolution of its own. The LSP consumers are green.

So this task was rewritten on 2026-08-16 to carry ONLY work that is necessary against shipped code. Six subtasks were archived (see the bottom); their files stay in `.backlog/archive/tasks/` and nothing is lost.

---

## 1. `theme_render_rc` resolves as a plain `render` — a measured false "safe to change"

The parser maps `{% theme_render_rc %}` to a `RenderMarkup` node. The graph's visitor (`traverse.ts:218`) branches only on `include` vs everything-else, so a theme reference is labelled `kind: 'render'` AND resolved via `locateOrDefault(root, 'render', name)` — the partial search path — instead of the theme search paths.

**check-common already gets this right.** `missing-partial/index.ts:8` branches on the parent tag name, maps to DocumentType `'theme_render_rc'`, and uses `getSearchPaths()`. So the lint and the graph answer the same question differently in the same process; the fix is to make the graph agree with the implementation that already exists next door.

**Measured on real projects (2026-08-16), which contradicts the old "low real-world impact" note:**

- 178 files in project-a use `theme_render_rc`; **1,332 files across the sample projects in ~/projects/pos**.
- All **17** distinct targets in project-a resolve to `app/views/partials/<name>.liquid` paths that **do not exist**. The real files live under `app/views/partials/theme/<theme>/…`, reached via `theme_search_paths` in `app/config.yml`.
- Consequence, from the SHIPPED `runImpact`: `app/views/partials/theme/custom/items/featured.liquid` → `status: computed, total: 0`. A live theme component is reported as depended on by nobody — the exact false approval `impact` exists to prevent.
- Second consequence: 17 phantom `exists: false` nodes, which any future `missingTargets()` sweep would report as broken references that are not broken.

## 2. Liquid inside frontmatter string values is never extracted

A reference in a frontmatter scalar (e.g. `response_headers: > {%- include '...' -%}`) is a real dependency the graph does not model: it walks the Liquid BODY and reads frontmatter only as YAML (slug/layout/method). Decide, then implement or write it down as a non-goal — an undocumented silence here reads as "there are no such edges".

Note for whoever takes it: the supervisor's candidate filter is textual, so a file with a frontmatter-embedded reference already survives it and is already parsed. The gap is purely in extraction; nothing about `project-scan.ts` changes.

## 3. Decide whether `.yml` is relational — then do Phase A only if the answer is yes

`validate_code` returns `not_applicable` for schema/custom-model-type and translation `.yml`. That is honest (they are wired by NAME, not by file reference) but blunt, and the raw material for the highest-value link already exists on both sides: `GraphQLModule.tables` and `SchemaModule.table`.

**The blocker to decide first.** `validate_code`'s dependents come from `extractFileReferences`, which walks a LIQUID AST. A table-name JOIN is a match between two extracted values and an association is a YAML declaration — neither can ever come out of a Liquid visitor. So making `.yml` `computed` needs a new per-file primitive in platformos-graph, or an explicit decision that `.yml` dependents need a whole-project build and stay `not_applicable` here. Decide before writing code; if the answer is "not now", say so in `impact.ts` beside the guard so the next reader does not re-derive it.

If the answer is yes: Phase A (graphql ↔ schema table join) only. Translation edges and model↔model associations are in the archived TASK-9.19 and stay there until Phase A proves the shape.

---

## Archived on 2026-08-16, and why (all recoverable from `.backlog/archive/tasks/`)

- **9.20** GraphCache fs.watch — cancelled; `GraphCache` was deleted, so there is nothing to keep fresh.
- **9.11** `project_map`, **9.12** `validate_project` — unbuilt tool proposals written against a cached graph that no longer exists. Write them fresh against the architecture of the day; 9.12's repair-order plan is the part worth lifting.
- **9.18** cross-file autofixes — five speculative fix classes stacked on those two tools.
- **9.7** resource/CRUD convention overlay — fed only `project_map`, and its proposed home is being dissolved by TASK-8.2.
- **9.19** YAML platform-fact edges — its decision + Phase A are item 3 above; Phases B/C stay archived.
- **9.21** reference-extraction gaps — carried here verbatim as items 1 and 2.

## Constraint that outlived the epic

All edge/resolution logic stays in `platformos-graph`; the supervisor shapes output. The one thing it now owns is a candidate-selection policy (`src/impact/project-scan.ts`, ~90 lines: read the edge sources, keep the ones containing the name). If a second consumer ever wants that policy, it MOVES into platformos-graph rather than being copied — two policies for one data structure is the mistake this repo already made once with the graph cache.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The graph's RenderMarkup visitor branches on the PARENT TAG NAME — `render`→'render', `include`→'include', `theme_render_rc`→a new `'theme_render_rc'` kind resolved via DocumentsLocator's `'theme_render_rc'` DocumentType (not the partial path). `'theme_render_rc'` is added to the ReferenceKind union (additive).
- [ ] #2 The graph and check-common's `MissingPartial` resolve the same `{% theme_render_rc %}` to the SAME URI — asserted by a test that exercises both, so the two implementations of one question cannot drift apart again.
- [ ] #3 Regression pinned on the measured failure: a theme component reachable only through `{% theme_render_rc %}` reports its real callers in `impact.dependents` (not `total: 0`), with a control proving the same fixture reports 0 for a component nothing references.
- [ ] #4 `theme_search_paths` from `app/config.yml` is threaded in, or the `locateDefault` fallback is shown to be sufficient by a test against a real multi-theme layout (project-a's `app/views/partials/theme/<theme>/…` is the shape to model).
- [ ] #5 Frontmatter-embedded Liquid: a decision is recorded (which keys can hold Liquid, the parse cost, how a source range inside a YAML scalar is expressed) and then EITHER extraction is implemented with a fixture OR it is documented as an explicit non-goal in the graph docs — not left silent.
- [ ] #6 A decision is recorded on whether `.yml` dependents are answerable per-file at all, given that `extractFileReferences` walks a Liquid AST and cannot yield a table-name join. Either a per-file primitive lands in platformos-graph, or `impact.ts`'s `isGraphTrackable` keeps `.yml` at `not_applicable` WITH the reason written beside the guard.
- [ ] #7 Only if that decision is yes: GraphQL ops are edge-linked to their schema by table-name join (`GraphQLModule.tables` × `SchemaModule.table`, both already extracted), `dependentsOf(schema)` returns the ops that query it, and schema nodes are materialized in SCOPED builds rather than only full ones.
- [ ] #8 All edge/resolution logic lands in platformos-graph; the supervisor gains no edge knowledge. Changes are additive to shared types.
- [ ] #9 Every claim is measured, not asserted: the theme_render_rc fix is re-run against ~/projects/pos (project-a is the project with 178 uses) and the before/after dependent counts are recorded on this task.
- [ ] #10 graph + check-common + supervisor + language-server suites, type-check and format:check green; no regression to existing edge kinds.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Where the evidence came from (2026-08-16)

Reproduce before trusting any number here.

- Usage count: `grep -rl "theme_render_rc" ~/projects/pos/*/app | wc -l` → 1,332 files; project-a alone 178.
- Phantom resolution: extract the quoted targets from project-a's `theme_render_rc` tags and test `app/views/partials/<name>.liquid` for each → 0 of 17 exist. The real files are at `app/views/partials/theme/{simple,custom}/items/featured.liquid` etc.
- The user-visible failure: call the shipped `runImpact` (from `dist/impact/impact.js`, with `createProjectScan`) on `app/views/partials/theme/custom/items/featured.liquid` → `status: computed, total: 0`. Its sibling `theme/simple/items/featured.liquid` returns 3, because those callers spell the full path through a plain `{% render %}` — which is what makes the `theme/custom` zero a silent wrong answer rather than an obvious one.
- The correct implementation to copy: `platformos-check-common/src/checks/missing-partial/index.ts` lines 8 and 48.

## What this task deliberately does NOT contain

No new MCP tools, no cross-file autofixes, no convention overlay, no graph cache. Those were archived the same day — see the description. This task is defect-closing work on shipped behaviour plus one decision, and it should stay that size.
<!-- SECTION:NOTES:END -->
