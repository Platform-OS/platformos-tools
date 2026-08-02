---
id: TASK-4
title: >-
  DocumentManager.app() filters Liquid only — use isSupportedSourceFile
  uniformly
status: Done
assignee: []
created_date: '2026-05-11 13:10'
updated_date: '2026-08-02 09:51'
labels:
  - language-server
dependencies:
  - TASK-3
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewritten 2026-08-02: one of the two callers this task existed for is already gone.

## Caller 1 — gone, no action

`platformos-check-node/src/index.ts` no longer filters a glob by hand. `getAppFilePaths`
(`index.ts:474`) walks `APP_SOURCE_SUBTREES`, keeps anything with a
`SOURCE_FILE_EXTENSIONS` extension, drops the user's configured `ignore`, and hands the
result to `App.fromPaths` — which classifies through `parseAppPath`. Its own comment
now states the rule this task was trying to establish: *"Candidates, not app files.
Which of them the app actually contains is `parseAppPath`'s answer … a second opinion
about what `app/lib/smses/x.liquid` is can only ever disagree with the first."*
Landed with TASK-12.6.3.

## Caller 2 — still there

`DocumentManager.ts:113`:

```ts
.filter(
  (sourceCode) =>
    sourceCode.type !== SourceCodeType.LiquidHtml || isKnownLiquidFile(sourceCode.uri),
) satisfies App;
```

Only Liquid is filtered, so a GraphQL or YAML file outside a known directory is in the
LSP's `app()` view and not in the CLI's. Replace with `isSupportedSourceFile`.

Note `set()` (`:140`) and the `preload` walk (`:173`) already use
`isSupportedSourceFile`, so this line is the last inconsistency inside the class —
which also means the practical effect is small: a file has to have got into
`sourceCodes` some other way to be caught by it. Worth doing as consistency, not as a
bug fix.

**Overlaps with TASK-3.1 and TASK-12.6.4.** If `DocumentManager` becomes an `App`
adapter (12.6.4), this filter stops existing rather than getting fixed. Do whichever
runs first and close the other.

**Files:**
- `packages/platformos-language-server-common/src/documents/DocumentManager.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `DocumentManager.app()` filters with `isSupportedSourceFile`, and the `isKnownLiquidFile` import is dropped
- [x] #2 `yarn build` and the language-server test suite pass; any fixture relying on a misplaced graphql/yaml file being included is moved rather than exempted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02. One line, as the rewrite predicted.

`DocumentManager.app()` filters with `isSupportedSourceFile` instead of
`sourceCode.type !== SourceCodeType.LiquidHtml || isKnownLiquidFile(uri)`, so all three
filters in the class (`set`, `preload`, `app`) now ask the same question and the LSP's
view of the app matches the CLI's. The `isKnownLiquidFile` import is gone; it now has
no caller outside `path-utils.ts` and its own spec.

Caller 1 needed nothing: check-node stopped hand-filtering its glob in TASK-12.6.3.

Language-server suite green, no fixture moved — nothing depended on a misplaced
graphql/yaml file being included.
<!-- SECTION:NOTES:END -->
