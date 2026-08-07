---
id: TASK-9.23
title: >-
  Fix: getModule mis-keys lib/nested partials by basename (splits node identity,
  corrupts dependents)
status: Done
assignee: []
created_date: '2026-07-07 13:34'
updated_date: '2026-07-07 13:57'
labels:
  - bug
  - platformos-graph
  - correctness
dependencies: []
modified_files:
  - packages/platformos-graph/src/graph/module.ts
  - packages/platformos-graph/src/graph/module.spec.ts
parent_task_id: TASK-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found via real-project verification on marketplace-dcra (2170-node graph).

DEFECT (pre-existing, on master; latent until a real project with `lib/`/nested partials was tested). `getModule` (the entry-point dispatcher) resolved a partial via `getPartialModule(appGraph, path.basename(uri, '.liquid'))`. `getPartialModule` rebuilds the path as `app/views/partials/<name>.liquid`, so it (a) drops the file's directory and (b) forces the `app/views/partials/` location. Any partial NOT flat under `app/views/partials/` — e.g. `app/lib/can/payment_request.liquid`, `app/lib/queries/v2/projects/find.liquid`, `app/lib/commands/...` — was mis-keyed to a PHANTOM `app/views/partials/<basename>.liquid` node (exists:false, no edges), split from the SAME file resolved as an edge target (which correctly goes through `getPartialModuleByUri`).

IMPACT. The full build lost these partials' real outgoing edges and materialized a phantom exists:false node instead; incremental applyFileChange re-materialized the real node, so incremental DIVERGED from a full build (a never-stale violation). Dependents/blast-radius/dead-code for every lib/nested partial were wrong — critical for a tool whose job is correct platformOS guidance. On marketplace-dcra, app/lib/** is where commands/queries/can-helpers live (heavily used).

FIX. getModule's partial branch keys by the file's own resolved URI via getPartialModuleByUri(appGraph, uri) — identical to how layout/page/asset entry points already key (this branch already fixed the same bug for assets in d09ab82; partials were left behind). For flat app/views/partials/* partials the result is byte-identical (no behavior change); only lib/nested partials are corrected. getPartialModule (name-based) retained as a test factory.

Root cause: packages/platformos-graph/src/graph/module.ts (getModule ~line 46). Regression tests in module.spec.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getModule keys a lib/nested partial entry point by its own URI (module.spec regression tests)
- [x] #2 Flat app/views/partials partials are unaffected (byte-identical keying)
- [x] #3 On marketplace-dcra, incremental applyFileChange no longer diverges from a full build (A4 harness passes)
- [x] #4 Full graph + supervisor suites, type-check, format green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed a severe, pre-existing graph correctness bug surfaced by real-project verification on marketplace-dcra (2266-node graph).

Root cause: `getModule` (module.ts) resolved a partial entry point via `getPartialModule(appGraph, path.basename(uri, '.liquid'))`, which rebuilds the path as `app/views/partials/<basename>.liquid` — dropping the file's directory and forcing the app/views/partials location. Every `lib/` or nested partial (e.g. `app/lib/can/payment_request.liquid`, `app/lib/commands/execute.liquid`) was mis-keyed to a phantom `app/views/partials/<basename>.liquid` node (exists:false, no edges), split from the same file resolved as an edge target (which correctly uses getPartialModuleByUri). Layout/page/asset entry points already keyed by full URI; partials were the odd one out (assets were fixed on this branch in d09ab82, partials left behind). Confirmed present on master.

Fix (one line): getModule's partial branch now calls `getPartialModuleByUri(appGraph, uri)` — key by the file's own resolved URI, consistent with the other factories. Flat app/views/partials/* partials are byte-identical (no change); only lib/nested partials are corrected. Name-based getPartialModule retained (used as a test factory). Added getModule regression tests to module.spec.ts (lib partial, nested lib partial, entry-point≡edge-target identity, flat-partial unaffected).

Impact measured on marketplace-dcra (before → after fix):
- edges 3287 → 5106 (+1819 real edges were being dropped)
- missing targets 752 → 29 (the 752 were mostly phantom mis-keyed lib partials)
- graphql nodes 237 → 283 (lib→graphql function calls now traversed)
- nodes 2170 → 2266
- incremental applyFileChange now ≡ a full build (was diverging — a never-stale violation); the busiest partial lib/commands/execute.liquid now correctly reports 150 distinct dependents (was corrupted).

Verification: module.spec RED→GREEN; full graph suite 109, supervisor 76, language-server 467 (clean run; the one intermittent fail was the documented TypeSystem.spec parallel-load flake, passes on re-run); prettier clean; graph dist rebuilt. Real-project harness (scoped≡whole-tree never-stale, buildAppGraph, extractGraphqlTables, incremental≡full, GraphCache, runImpact, end-to-end runValidateCode): ALL CHECKS PASSED.
<!-- SECTION:FINAL_SUMMARY:END -->
