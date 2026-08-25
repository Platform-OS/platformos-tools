---
id: TASK-89
title: 'Move frontmatter block extraction into platformos-common, behaviour unchanged'
status: Done
assignee: []
created_date: '2026-08-24 12:31'
updated_date: '2026-08-24 12:46'
labels:
  - platformos-common
  - check-common
  - refactor
dependencies: []
references:
  - packages/platformos-check-common/src/frontmatter/extract.ts
  - packages/platformos-common/src/frontmatter.ts
  - packages/platformos-common/src/app/AppFile.ts
  - packages/platformos-common/src/guards/package-boundaries.spec.ts
  - packages/platformos-graph/src/graph/traverse.ts
modified_files:
  - packages/platformos-common/src/frontmatter/schemas.ts
  - packages/platformos-common/src/frontmatter/extract.ts
  - packages/platformos-common/src/frontmatter/extract.spec.ts
  - packages/platformos-common/src/frontmatter/index.ts
  - packages/platformos-common/src/yaml-load-options.ts
  - packages/platformos-common/src/guards/package-boundaries.spec.ts
  - packages/platformos-common/package.json
  - packages/platformos-check-common/src/frontmatter/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-frontmatter-syntax/index.ts
  - >-
    packages/platformos-check-common/src/checks/invalid-frontmatter-value/index.ts
  - >-
    packages/platformos-check-common/src/checks/unknown-frontmatter-field/index.ts
  - >-
    packages/platformos-check-common/src/checks/deprecated-frontmatter-field/index.ts
  - >-
    packages/platformos-check-common/src/checks/missing-frontmatter-association/index.ts
  - packages/platformos-check-common/src/checks/missing-layout/index.ts
  - .changeset/frontmatter-extraction-moves-to-common.md
priority: medium
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frontmatter block extraction currently lives in `packages/platformos-check-common/src/frontmatter/extract.ts`, while the SCHEMAS it validates against already live in `packages/platformos-common/src/frontmatter.ts`. Knowing what a frontmatter block IS is platformOS domain knowledge, which is what platformos-common exists to hold (see the rationale comment in its `src/index.ts` covering RouteTable, DocumentsLocator and the frontmatter schemas). The extraction belongs beside the definition.

THREE READERS EXIST TODAY, and this task moves one of them:

1. `liquid-html-parser` — the grammar's `yamlFrontmatter` rule produces a `YAMLFrontmatter` node carrying `.body`.
2. `platformos-graph/src/graph/traverse.ts` — `loadFrontmatter()`, js-yaml with `PLATFORM_YAML_LOAD_OPTIONS`, reading reader 1's node. Used for the layout edge, slug and method.
3. `platformos-check-common/src/frontmatter/extract.ts` — its own delimiter scan plus npm `yaml` `parseDocument`. Used by the six frontmatter checks.

Readers 2 and 3 disagree about duplicate keys. That disagreement is NOT this task — it is filed separately and must not be folded in here, because a behaviour change destroys the only proof that this move was faithful.

SCOPE IS INTERNAL. `FrontmatterBlock` and `frontmatterBlock` are not exported from check-common's public barrel (`src/frontmatter/index.ts` re-exports only the platformos-common schema types) and nothing outside check-common imports them. No breaking change, no consumer migration.

DESIGN DECISIONS, each of which has a reason that must survive in the code:

- `src/frontmatter.ts` becomes a DIRECTORY `src/frontmatter/{index.ts,schemas.ts,extract.ts}`, matching `route-table/`, `graphql/`, `translation-provider/`, `documents-locator/`. The root barrel's `export * from './frontmatter'` is unchanged by this.

- THE HAND-ROLLED DELIMITER SCAN STAYS, and gains a docblock saying why. Reading the `YAMLFrontmatter` AST node instead would be layering-illegal here (platformos-common sits below the parser stack; `AppFile.ast` is typed `unknown` for that reason), and — the substantive reason — it would make every frontmatter check depend on the Liquid file PARSING. A file with an unrelated Liquid syntax error would silently report no frontmatter findings at all. The string scan is what keeps frontmatter analysis independent of Liquid parse success.

- THE MODULE-LEVEL `WeakMap` GOES, replaced by `AppFile.derived()`, which exists for exactly this and whose own docblock argues against the content-keyed module cache. check-common already uses `derived()` in four places (`variable-types.ts`, `partial-call-arguments/extract-undefined-variables.ts`, `rollback-outside-transaction` x2). Split the pure function from the memo: `extractFrontmatterBlock(source, fileType)` takes no file and caches nothing; `frontmatterBlock(file, fileType)` is the `derived()` wrapper. One `derived` key means graph, language server and linter share a single parse.

- `wellFormedFrontmatterBlock` moves too. It is a one-liner over the block with no lint concepts in it.

- npm `yaml` ^2.8.2 becomes a dependency of platformos-common. js-yaml cannot produce the per-node offsets every frontmatter offense needs, so this is unavoidable rather than convenient. It is pure JS and browser-safe, and already reaches the browser bundles transitively, so the boundary `guards/package-boundaries.spec.ts` protects (no workspace parser package, no Node-only import) still holds. Both of that spec's assertions must be updated deliberately.

- platformos-common will then hold TWO YAML libraries. Which one is for what — `yaml` for offsets, js-yaml for values — needs one written statement beside `PLATFORM_YAML_LOAD_OPTIONS`, so the split is not rediscovered later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Frontmatter block extraction, its types, and the well-formed filter are exported from platformos-common and no longer defined in platformos-check-common
- [x] #2 The frontmatter check suites (frontmatter-checks.spec.ts, frontmatter-codes.spec.ts, invalid-frontmatter-syntax.spec.ts) pass with import lines as the ONLY diff — this is the behaviour-preservation proof and any other edit to them invalidates it
- [x] #3 The per-file parse is memoized through AppFile.derived() and the module-level WeakMap is gone
- [x] #4 A test proves the memo is invalidated when the file's source changes, and fails if the derived key is broken
- [x] #5 guards/package-boundaries.spec.ts passes with 'yaml' added to both the pinned dependency list and satisfying the imports-what-it-declares assertion
- [x] #6 The retained string-based delimiter scan carries a docblock stating that reading the YAMLFrontmatter AST node would couple frontmatter findings to Liquid parse success
- [x] #7 A statement of which YAML library is used for what lives beside PLATFORM_YAML_LOAD_OPTIONS
- [x] #8 Full suites pass for platformos-common, platformos-check-common, platformos-check-node, platformos-mcp-supervisor, platformos-language-server-common and platformos-graph, plus type-check and format:check
- [x] #9 No behaviour change: duplicate-key and prettyErrors handling is carried over exactly as it is today
- [x] #10 A changeset accompanies the change
- [x] #11 extract.spec.ts moves to platformos-common. Its eight EXTRACTION cases keep their inputs and expectations verbatim, retargeted at the pure extractFrontmatterBlock(source, fileType) and dropping the `page()` object wrapper the old API forced. Its three MEMOISATION cases are rewritten against a real AppFile, because derived() is an AppFile method and a plain { source } object can no longer stand in
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. platformos-common: `src/frontmatter.ts` → `src/frontmatter/schemas.ts` (git mv, only its `./path-utils` import becomes `../path-utils`).
2. platformos-common: add `src/frontmatter/extract.ts` — pure `extractFrontmatterBlock(source, fileType)` plus the `derived()`-backed `frontmatterBlock(file, fileType)` and `wellFormedFrontmatterBlock`. Delimiter scan carried over unchanged, with the docblock explaining why it does not read the YAMLFrontmatter AST node.
3. platformos-common: `src/frontmatter/index.ts` re-exports both halves. Root barrel line is untouched.
4. platformos-common: add `yaml` ^2.8.2 to package.json; update the pinned list in `guards/package-boundaries.spec.ts`.
5. platformos-common: note beside `PLATFORM_YAML_LOAD_OPTIONS` saying which YAML library is used for what.
6. platformos-common: `src/frontmatter/extract.spec.ts` — extraction cases retargeted at the pure function, memo cases rewritten against a real AppFile via `createAppFile` + `setSource`.
7. platformos-check-common: delete `src/frontmatter/extract.ts` and its spec; `src/frontmatter/index.ts` re-exports the new symbols from platformos-common; update the six check imports.
8. Build platformos-common, then check-common (the factory configs and every downstream package read built output).
9. Full suites + type-check + format:check. Sabotage the extractor and the derived key.
10. Changeset. No commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two things worth carrying forward.

ONE OBSTACLE THE PLAN DID NOT ANTICIPATE. `onCodePathStart(file)` is declared `SourceCode<T>`,
not `AppFile`, so the six checks could not pass their `file` argument to a `derived()`-backed
function. `context.file` is the SAME OBJECT — `filesOfType` returns `TypedAppFile[]` and
`index.ts` hands that one object to both `createCheck` (which sets `context.file`) and
`onCodePathStart` — so the checks now read `context.file`, which is a no-op at runtime and the
idiom `rollback-outside-transaction/index.ts:318` already uses. Widening the common API to accept
a structural `{ source }` was the alternative and was rejected: it would have made the memo
unreachable for exactly the callers it exists for.

A STALE-`dist` TRAP, worth knowing about for any file-to-directory move. `tsc -b` does not delete
outputs for removed sources, so `dist/frontmatter.js` survived beside the new `dist/frontmatter/`
and CommonJS resolved the FILE first — every frontmatter check failed with
`frontmatterBlock is not a function` while the sources were correct. `rm -rf dist` before
rebuilding. A clean checkout is unaffected; this only bites incremental local builds.

Also fixed in passing: a raw NUL byte had ended up inside the `derived` key's template literal.
It was invisible in an editor AND it made `grep` treat the file as binary and silently report
nothing. Now written as the `` escape, matching
`partial-call-arguments/extract-undefined-variables.ts`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Frontmatter block extraction moved from platformos-check-common to platformos-common, beside the
schemas it validates against. Behaviour is unchanged and proven so: the three frontmatter check
suites have a ZERO diff — not even an import line — because they import the checks rather than the
extractor.

`src/frontmatter.ts` became `src/frontmatter/{index,schemas,extract}.ts`, matching the directory
convention of `route-table/`, `graphql/` and `documents-locator/`. The root barrel line was
untouched.

The API is split: `extractFrontmatterBlock(source, fileType)` is pure, and
`frontmatterBlock(file, fileType)` memoizes it through `AppFile.derived()`, replacing the
module-level WeakMap. The derived key carries `fileType`, with a test that fails if it does not.

`yaml` ^2.8.2 added to platformos-common — js-yaml exposes no node ranges, and every frontmatter
diagnostic needs offsets. Both assertions in `guards/package-boundaries.spec.ts` updated
deliberately. `yaml-load-options.ts` now records which YAML library is used for what, and states
plainly that `extract.ts` currently takes `yaml`'s defaults and therefore DISAGREES with the
duplicate-key decision beside it — TASK-90 settles that.

Two sabotages, both bit: a constant derived key fails the file-type test; a corrupted extractor
fails five.

Verification: common 571 (559 + the 12 moved/added), check-common 1752 (1763 − the 11 that left),
graph 113, check-node 195, supervisor 487, language-server 595. Type-check and format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
