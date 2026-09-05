---
id: TASK-104
title: >-
  Four pieces of visitor/ignore code that cannot run, or run untested — each
  measured, each needing a decision
status: To Do
assignee: []
created_date: '2026-09-05 15:53'
labels:
  - testing
  - platformos-check-common
  - dead-code
  - mutation-testing
dependencies: []
references:
  - packages/platformos-check-common/src/visitor.ts
  - packages/platformos-check-common/src/visitor.spec.ts
  - packages/platformos-check-common/src/ignore.ts
  - >-
    packages/platformos-language-server-common/src/formatting/providers/HtmlElementAutoclosingOnTypeFormattingProvider.ts
priority: low
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Stryker run over `check-common/visitor.ts` scored 79.23% with 27 outstanding mutants and found NO user-facing malfunction. What it did find is code that cannot run, a public export nothing calls, a supported capability with no user, and one boundary held up by a single test in another package.

Grouped as one task because all four are small and share a cause: mutation testing flags them identically, and three of the four `visitor.ts` clusters turned out to be unreachable code rather than coverage gaps — which is itself the reason to clear them. They make the NEXT run noisy to triage.

EVERY ITEM BELOW WAS VERIFIED CROSS-PACKAGE. `visitor.ts` is consumed by six language-server providers, so a mutant surviving check-common's suite proves nothing on its own; each was re-tested against `platformos-language-server-common` (595 tests) with check-common REBUILT first, since the language server imports it from `dist`.

1. `isUnclosed`'s `children` branch is UNREACHABLE — 6 mutants.

       } else if ('children' in node) {
         return node.children!.length > 0;

   Measured: making it always-true (`>= 0`) or removing the branch entirely leaves check-common
   1821/1821 and the language server 595/595. A planted `throw` is never hit by either suite.
   Reachability was then settled from the parser rather than the tests: the only node type
   carrying `children` without `blockEndPosition` is `Document` — confirmed under the
   `{ allowUnclosedDocumentNode: true, mode: 'tolerant' }` parse the autoclosing provider
   actually uses — and `isUnclosed` is only ever applied to a node's CHILDREN, never the root.

   Not a bug today. It is a hazard: `children.length > 0` is a semantically wrong definition of
   "unclosed", and if a node type ever gains `children` without `blockEndPosition`,
   `findCurrentNode` would descend into it regardless of cursor position — wrong hover,
   definition, rename and highlight targets. The `blockEndPosition` half is by contrast well
   covered: mutating it fails 11 language-server tests.

2. `findJSONNode` is EXPORTED WITH ZERO CONSUMERS — 3 mutants. Only `visitor.ts` and
   `visitor.spec.ts` mention it anywhere in the monorepo, and it reaches the public surface via
   `export * from './visitor'` in the package index. Its cursor boundary (`offset <
   child.loc.end.offset`) survives mutation in both packages — its own spec exercises the
   function without pinning the boundary.

3. THE `R[]` HALF OF THE VISITOR CONTRACT IS UNEXERCISED — 2 mutants. `VisitorMethod` returns
   `Promise<R | R[] | undefined>`, but every consumer found uses `void`, `boolean` or `string`.
   Deleting the `Array.isArray(result)` branch in `visit` breaks nothing anywhere.

4. `isCovered`'s DOCUMENTED BOUNDARY IS ONE ASSERTION DEEP. The default case deliberately differs
   from the String/VariableLookup/LogicalExpression/Comparison cases — `start < offset` against
   `start <= offset`, which the comment describes as "the cursor in the [excluded, included]
   range". Mutating the default to `<=` passes all 1821 check-common tests and fails exactly ONE
   language-server test. Real coverage, but the property belongs to `visitor.ts` and nothing in
   its own package holds it.

ALSO, same class, different file: `ignore.ts`'s `checkIgnorePatterns` opens with
`if (!checkDef) return []`, and its only caller `ownMatchers` has already returned for that case.
A planted `throw` passes all 1821 tests. Three mutants, all unreachable.

NOT IN SCOPE, and deliberately: the `nonTraversableProperties` guard in `forEachChildNodes`.
Its mutant survives, but the file's own docblock already explains why — the guard defends the
AUGMENTED AST the prettier plugin builds, measured as unpopulated across 3957 real nodes. Correct
behaviour, correct justification, leave it.

TWO OF THESE ARE PUBLIC-SURFACE DECISIONS, not mechanical deletions. Removing `findJSONNode`
deletes an export, and narrowing `VisitorMethod` to drop `R[]` changes a published type. Either
may be right; both need a call and a changeset if taken.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `isUnclosed`'s `children` branch is resolved: removed as unreachable, or kept with a comment stating why it cannot currently run and what would make it run — `children.length > 0` must not stand unexplained as a definition of 'unclosed'
- [ ] #2 If the branch is removed, the `blockEndPosition` behaviour is unchanged — the 11 language-server tests that cover it still pass
- [ ] #3 `findJSONNode` is resolved: deleted from the public surface, or kept with a note that it has no consumer; if kept, its cursor boundary is pinned by a test that fails when `offset < end` becomes `offset <= end`
- [ ] #4 The `R[]` return contract is resolved: dropped from `VisitorMethod`, or kept and covered by a test using a visitor that returns an array
- [ ] #5 `isCovered`'s default-vs-special boundary is pinned by a test in platformos-check-common, so the property does not depend on a single assertion in a sibling package
- [ ] #6 `ignore.ts`'s unreachable `if (!checkDef)` in `checkIgnorePatterns` is removed and its parameter narrowed, or kept with a reason
- [ ] #7 SABOTAGE-VERIFIED for whatever is kept or added: the mutation each item names fails a test afterwards; reverted, and the suites are green
- [ ] #8 platformos-check-common and platformos-language-server-common suites pass, plus type-check and format:check — with check-common REBUILT before running the language server, since it imports from `dist`
- [ ] #9 A changeset accompanies the change if any public export or published type is altered
<!-- AC:END -->
