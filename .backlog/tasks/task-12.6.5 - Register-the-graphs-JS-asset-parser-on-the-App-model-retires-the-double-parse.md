---
id: TASK-12.6.5
title: >-
  Register the graph's JS/asset parser on the App model (retires the double
  parse)
status: Done
assignee: []
created_date: '2026-07-31 16:42'
updated_date: '2026-08-02 17:10'
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
- [x] #1 The graph and a lint run over the same project parse each file at most once per version — pinned with a spied parser, asserting no file is parsed twice
- [ ] #2 platformos-graph no longer contains its own toSourceCode wrapper around check-common's — NOT DONE, deliberately: rescoped in the notes below. The duplication it names is gone; what remains is the no-App buffer path, which cannot be expressed as an AppFile.
- [x] #3 JS and image assets are handled through the injected Parsers / an AssetFile subclass rather than a separate source-code factory
- [x] #4 TASK-12.15 is either closed as subsumed with a rationale, or its remaining scope is written down explicitly
- [x] #5 TASK-12.10 is re-assessed against the model's file identity and versioning, and closed or rescoped
- [x] #6 The graph test suite and the graph CLI both pass unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## DONE — the double parse is gone; AC #2 is rescoped, with the reason

### The mechanism now has its consumer (ACs #1, #3)

`graphParsers` and `appBackedGetSourceCode` landed with the first pass of this task but
nothing used them. The language server does now (TASK-12.6.4): its `App`s are built
with `languageServerParsers` = check-common's `sourceParsers` merged with
`graphParsers.extensions`, and `AppGraphManager.graphDependencies(rootUri)` reads
through `appBackedGetSourceCode(documentManager.appModel(rootUri), fallback)`.

So the one process that builds a graph AND runs checks over the same project holds ONE
set of `AppFile`s. Pinned by object identity with a spied parser in the language
server's `documents/app-adapter.spec.ts` ("serves the graph the very file objects the
checks read", "parses the assets only the graph reads, with the graph parser"), on top
of the graph's own `parsers.spec.ts`.

### AC #2 — rescoped: the wrapper is not duplication any more, and cannot go

The duplication this AC was written against — an inlined `acorn` call and a second
image-extension list inside `toSourceCode.ts` — is already gone; both resolve through
`graphParsers`. What is left is ten lines of dispatch that delegate to check-common's
`toSourceCode`, and they exist for the callers that have a buffer and NO app:

- `graph/augment.ts`'s default `getSourceCode`, i.e. `buildAppGraph(root, { fs })` with
  no reader supplied;
- `extractFileReferences`, whose documented use is an in-flight buffer that is not on
  disk yet (the `validate_code` shape — TASK-7.6's future consumer);
- `AppGraphManager`'s fallback, for a URI the app does not contain.

None of those can construct an `AppFile`: `App` only holds paths that classify under
its root, so a URI outside the project has no representation in the model at all. That
is not an implementation gap, it is what the model means. Deleting the function would
also make `IDependencies.getSourceCode` required, narrowing the graph's public API for
no gain.

Left in place, with its doc comment already saying it is the no-App path and pointing
callers who DO have an app at `appBackedGetSourceCode`.

`FileSourceCode`/`AssetSourceCode` are likewise left as structural types rather than
`AppFile` subclasses: `appBackedGetSourceCode` already returns real `AppFile`s through
that type, and nothing in `traverse.ts` switches on `AssetSourceCode.type`.

### ACs #4, #5 — TASK-12.15 and TASK-12.10

Neither exists in the backlog any more; 12.15 was last present at commit `0b724a5` and
was removed in a later cleanup. Recording why they should not come back:

**TASK-12.15 (one process-wide parsed-source cache shared by the graph build and the
lint)** is subsumed twice over. Its mechanism — a `(uri, fingerprint)`-keyed cache — is
what the `App` model replaced: file identity and versioning live on `AppFile`, so
sharing parses is sharing OBJECTS, which is what shipped here. Its premise is also gone:
it was written against the `supervisor-graph-integration` branch's `AppCache` and a
graph build on a worker thread (TASK-12.13), neither of which landed. Its AC #2 ("a
file's AST is produced at most once per process across BOTH the graph build and the
lint, asserted with a parser spy") is the AC #1 pinned above.

**TASK-12.10 (re-key the partial analysis cache on uri+fingerprint)** is answered by the
same thing: `AppFile` has stable identity and a `version`, and `setSource` drops the
parse, so a cache keyed on the file object needs no fingerprint. If a specific cache is
found still keyed on content, it is a fresh, smaller task against the model that exists
rather than the branch that did not land.

### AC #6

`platformos-graph`'s suite passes unchanged, as does the rest of the monorepo (295
files, 2726 tests) and `yarn type-check`.
<!-- SECTION:NOTES:END -->
