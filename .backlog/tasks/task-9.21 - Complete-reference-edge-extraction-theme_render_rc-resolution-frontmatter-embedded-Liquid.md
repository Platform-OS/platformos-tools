---
id: TASK-9.21
title: >-
  Complete reference-edge extraction: theme_render_rc resolution +
  frontmatter-embedded Liquid
status: To Do
assignee: []
created_date: '2026-07-03 07:38'
labels:
  - platformos-graph
  - edges
  - code-review
  - tech-debt
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-common/src/documents-locator/DocumentsLocator.ts
  - packages/platformos-check-common/src/types.ts
parent_task_id: TASK-9
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two deferred edge-extraction gaps carried over from TASK-9.4 and TASK-9.9 (both closed on their stated ACs; these remnants moved here so they are not lost).

GAP 1 — `theme_render_rc` mislabeled + mis-resolved (from TASK-9.4 impl notes). The parser maps `{% theme_render_rc %}` to a `RenderMarkup` node, so the graph's `RenderMarkup` visitor catches it and labels it `kind:'render'`, resolving via the partial path `app/views/partials/<name>.liquid`. But theme_render_rc resolves through THEME SEARCH PATHS (DocumentsLocator already has a dedicated `'theme_render_rc'` DocumentType). So a theme_render_rc edge is mislabeled `render` and points at a wrong/absent partial → wrong dependency/orphan output, disagreeing with the LSP. Fix: in the graph `RenderMarkup` visitor branch on the parent tag name — `render`→'render', `include`→'include', `theme_render_rc`→new kind `'theme_render_rc'` resolved via `DocumentsLocator(rootUri,'theme_render_rc',name)` (NOT getPartialModule). Add `'theme_render_rc'` to the `ReferenceKind` union in check-common types.ts (additive). May need `theme_search_paths` from app/config.yml (loadSearchPaths) — confirm whether to thread it in or accept the locateDefault fallback. Low real-world impact (theme components), but a genuine latent correctness/consistency bug.

GAP 2 — Liquid embedded inside frontmatter string values (from TASK-9.9 AC#7). A reference inside a frontmatter YAML string value (e.g. `response_headers: > {%- include '...' -%}`) is a real dependency the graph does NOT extract: it models the Liquid BODY AST and reads frontmatter only as YAML (for slug/layout/method). DECIDE first, then implement or document as an explicit non-goal: which frontmatter keys can contain Liquid, the perf cost of parsing string values as Liquid, and how to represent the edge's source range (the range inside the YAML scalar).

Both are static, name/reference-based edges (the same safety class as the existing edges) and belong in platformos-graph (ADR 003). TDD with fixtures; preserve additive/whole-value conventions.

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 theme_render_rc: the graph RenderMarkup visitor branches on parent tag name and emits a new kind 'theme_render_rc' resolved via DocumentsLocator('theme_render_rc'), not the partial path; 'theme_render_rc' added to the ReferenceKind union (additive); fixture + spec; output matches the LSP resolution
- [ ] #2 frontmatter-embedded Liquid: a design decision is recorded (which keys, perf, source-range) and then EITHER extraction of Liquid references in frontmatter string values is implemented (with a fixture) OR it is documented as an explicit non-goal in the graph docs
- [ ] #3 Changes are additive; graph + check-common + LSP suites + type-check + format green; no regression to existing edge kinds
<!-- AC:END -->
