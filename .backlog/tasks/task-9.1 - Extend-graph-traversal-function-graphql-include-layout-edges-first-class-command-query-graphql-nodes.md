---
id: TASK-9.1
title: >-
  Extend graph traversal: function/graphql/include/layout edges + first-class
  command/query/graphql nodes
status: To Do
assignee: []
created_date: '2026-06-23 10:32'
labels: []
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/graph/build.ts
  - packages/platformos-graph/src/types.ts
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
- [ ] #1 traverseModule emits function, graphql, include, and layout-association edges; targets are first-class modules in the graph
- [ ] #2 Reference carries an optional, additive `kind` discriminant; existing consumers compile and pass unchanged
- [ ] #3 Target resolution reuses check-common (DocumentsLocator/file-type), not bespoke path logic
- [ ] #4 Graph unit tests pin the new edge kinds; LSP references/dependencies/dead_code re-verified green
<!-- AC:END -->
