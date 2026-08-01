---
id: TASK-12.6.5
title: >-
  Register the graph's JS/asset parser on the App model (retires the double
  parse)
status: To Do
assignee: []
created_date: '2026-07-31 16:42'
labels:
  - platformos-graph
  - performance
dependencies:
  - TASK-12.6.1
parent_task_id: TASK-12.6
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/platformos-graph/src/toSourceCode.ts` is a third implementation of "parse a project file": it delegates liquid/json/graphql/yml to check-common's eager `toSourceCode` and adds its own `acorn` parse for `.js` plus `AssetSourceCode` for images. Because it builds its own objects, the graph build and the lint parse the same files twice — which is the entire reason TASK-12.15 (`Eliminate the double parse: one process-wide parsed-source cache shared by the graph build and the lint`) exists.

The injected `Parsers` map from 12.6.1 is the intended mechanism: the graph registers a JS parser and an asset handler for extensions the lint does not care about, and then graph and lint hold the SAME `AppFile` instances, so each file is parsed at most once per version for both. No shared cache needed — the model IS the shared cache.

## Change

- Move the `acorn` JS parse and the asset classification into `Parsers` entries / an `AssetFile` subclass supplied by the graph.
- Delete `platformos-graph/src/toSourceCode.ts`'s duplication of `tcToSourceCode`.
- `FileSourceCode` / `AssetSourceCode` in `graph/types.ts` should become the `AppFile` subclasses, or thin views over them.
- Note that `platformos-graph` is the ONE package that already declares `@platformos/platformos-common` (at `0.0.17`), so the dependency direction is already correct here — coordinate the version with 12.6.2.

## Then close TASK-12.15

If this lands as described, TASK-12.15 has no remaining content — verify that and close it with a pointer here rather than implementing a separate process-wide parsed-source cache. Confirm the same for TASK-12.10 (`Re-key the partial analysis cache on uri+fingerprint`), which may also be subsumed once files have stable identity and versions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The graph and a lint run over the same project parse each file at most once per version — pinned with a spied parser, asserting no file is parsed twice
- [ ] #2 platformos-graph no longer contains its own toSourceCode wrapper around check-common's
- [ ] #3 JS and image assets are handled through the injected Parsers / an AssetFile subclass rather than a separate source-code factory
- [ ] #4 TASK-12.15 is either closed as subsumed with a rationale, or its remaining scope is written down explicitly
- [ ] #5 TASK-12.10 is re-assessed against the model's file identity and versioning, and closed or rescoped
- [ ] #6 The graph test suite and the graph CLI both pass unchanged
<!-- AC:END -->
