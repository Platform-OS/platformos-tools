---
id: TASK-9.9
title: Graph asset resolution fix + real-project validation (frontmatter-Liquid gap)
status: Done
assignee: []
created_date: '2026-07-01 18:38'
updated_date: '2026-07-03 07:39'
labels:
  - code-review
  - platformos-graph
  - platformos-common
  - bug
  - validation
dependencies: []
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ran `platformos-graph` against a real production project (~/Work/POS/tertius/marketplace-dcra: 1,505 nodes / 3,287 edges) to verify the branch's edge/structural extraction works reliably, not just "runs". Thorough consistency checks: referential integrity (0 dangling edges, 0 dup nodes, all edges have kind+range), determinism (byte-identical across two builds), exists=true accuracy (0 false positives in 200 sampled), coverage (pages 326/326 & layouts 13/13 exact), edge extraction reconciled statement-for-statement against source incl. `{% liquid %}` blocks (function 5=5, graphql 9=9), and every non-asset "missing" target confirmed GENUINE (real missing module files, an uninstalled module, and a real project typo `event_isnpections`) — i.e. the graph correctly flags real broken references.

The validation surfaced TWO issues, captured here:

BUG (FIXED) — asset resolution base path. The graph's `getAssetModule` resolved `asset_url` targets against `<root>/assets/` (hardcoded), but platformOS assets live at `<root>/app/assets/` (and `modules/<m>/public/assets/`). This is the ONE edge kind that bypassed DocumentsLocator (every other kind — render/include/function/graphql/layout — routes through it). Effect on the real project: 27 of 28 asset edges were FALSE `exists=false` (the files exist), plus malformed `assets/app/assets/...` URIs. Pre-existing (from the Jan-31 'rename packages' commit, not this branch), but a real reliability defect in the `exists`/missing-target signal for assets. The MissingAsset check and the LSP DocumentLinksProvider already resolved assets correctly via DocumentsLocator — only the graph reinvented it wrongly.

LIMITATION (DEFERRED) — Liquid embedded inside frontmatter is not traversed. A reference inside a frontmatter YAML string value (e.g. `response_headers: > {%- include '...' -%}`) is a real dependency the graph does not extract: it models the Liquid BODY AST and reads frontmatter as YAML (for slug/layout/method). Consistent and defensible, but a known gap. Deciding whether to parse Liquid inside frontmatter string values needs design (which frontmatter keys, perf, how to represent the edge's source range).

Working dir: ~/Work/platformos-tools/platformos-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Asset edges resolve through DocumentsLocator ('asset' type: app/assets, module public/assets) instead of a hard-coded base — matching every other edge kind and the MissingAsset check/LSP.
- [x] #2 A resolved asset yields an exists:true Asset node at its real app/assets path; a missing asset yields an exists:false node at the canonical app/assets/<name> path (missing-asset detection preserved).
- [x] #3 The historical supported-extension gate is preserved (asset_url on a non-asset value creates no edge).
- [x] #4 TDD: new asset-edges fixture + traverse-edges tests (resolved, top-level, missing, exact-edge-set) written RED-then-GREEN; DocumentsLocator.locateDefault('asset') unit tests (app + module + locateOrDefault fallback) added; the non-conformant skeleton fixture moved to app/assets with build.spec/query.spec/cli.spec expectations updated.
- [x] #5 Verified on the real project: asset false-missing count drops from 27 to 1 (the 1 genuinely-absent asset), targets resolve under app/assets, previously-false-negative assets now exists:true.
- [x] #6 All suites green + type-check (direct tsc) + format:check + frozen-lockfile.
- [ ] #7 DEFERRED: decide + (if accepted) implement extraction of Liquid references embedded in frontmatter string values (response_headers etc.), or document it as an explicit non-goal in the graph docs.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ASSET FIX (done): routed the graph's asset edge through DocumentsLocator like every other kind.
- traverse.ts asset visitor: `documentsLocator.locateOrDefault(rootUri, 'asset', name)` + `getAssetModuleByUri`; the supported-extension gate preserved via exported `isSupportedAssetFile`.
- module.ts: removed the buggy `getAssetModule` (hardcoded `<root>/assets`); added `getAssetModuleByUri` (normalizes, mirrors the other ByUri factories) + `isSupportedAssetFile`; fixed getModule's (dead) asset branch to use the resolved URI.
- DocumentsLocator.ts: split `asset` out of the theme_render_rc/undefined group in `locateDefault` → canonical `app/assets/<name>` (or `modules/<m>/public/assets/<name>`), ext='' — so locateOrDefault yields a canonical target for a missing asset (missing-asset detection preserved). `locate('asset')` was already correct (app/assets) — only the graph had reinvented it.

TDD: new fixtures/asset-edges + 4 traverse-edges tests (RED→GREEN); DocumentsLocator.spec updated (asset locateDefault app + module + 2 locateOrDefault cases; the old 'asset → undefined' expectation replaced); moved the non-conformant skeleton fixture assets/ → app/assets/ and updated build.spec (node+edge sort order), query.spec (reachableFrom order), cli.spec (node/edge sets + nodeFileSystem paths), supervisor structure.spec (asset target → app/assets/app.js).

REAL-PROJECT VALIDATION (marketplace-dcra): asset false-missing dropped 27→1 (the 1 genuinely-absent asset); targets now resolve under app/assets; previously-false-negative emails/logo.png now exists:true. Referential integrity / determinism / exists-accuracy / coverage all clean (see description).

VERIFICATION: common 261, graph 84, check-common 1057, supervisor 56, LSP 467 (1 full-suite fail = the documented TypeSystem parallel-load flake, passes 41/41 isolated; DocumentLinksProvider — the LSP asset consumer — 8/8). Direct-tsc type-check clean all packages; format:check clean; frozen-lockfile clean, zero yarn.lock churn. common+graph dist rebuilt.

DEFERRED (AC #7): frontmatter-embedded Liquid (e.g. response_headers: > {%- include -%}) not extracted — needs a design decision (which keys, perf, source-range representation) or an explicit non-goal doc entry. Left as the one open AC.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Asset-resolution bug FIXED + real-project validation done (ACs #1–#6). Routed the graph's `asset_url` edge through DocumentsLocator (`'asset'` type: app/assets, module public/assets) like every other edge kind, replacing the hard-coded `<root>/assets/` base; preserved the supported-extension gate; missing asset → canonical `app/assets/<name>` exists:false node. TDD: asset-edges fixture + traverse tests + DocumentsLocator locateDefault('asset') unit tests; skeleton fixture moved to app/assets with build/query/cli/structure specs updated. Verified on marketplace-dcra: asset false-missing dropped 27→1 (the 1 genuinely-absent asset); referential integrity / determinism / exists-accuracy / coverage all clean. All suites + direct-tsc type-check + format + frozen-lockfile green; common+graph dist rebuilt.

AC#7 (extract Liquid embedded in frontmatter string values, e.g. `response_headers: > {%- include -%}`) was DEFERRED — it needs a design decision (which keys, perf, source-range representation). Moved to TASK-9.21 (with the theme_render_rc edge gap) so it is tracked; closing this task on its completed asset-fix + validation scope.
<!-- SECTION:FINAL_SUMMARY:END -->
