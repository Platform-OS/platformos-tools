---
id: TASK-4
title: Replace inlined extension filters with isSupportedSourceFile
status: Done
assignee: []
created_date: '2026-05-11 13:10'
updated_date: '2026-08-07 12:51'
labels: []
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Now that `isSupportedSourceFile` is the single source of truth (task 3), eliminate the two callers that hand-roll a subset of its logic.

**Caller 1 — `packages/platformos-check-node/src/index.ts:144-163`**

Current code inside `getApp().glob().filter(...)`:
```ts
if (filePath.endsWith('.liquid') && !isKnownLiquidFile(filePath)) return false;
if (filePath.endsWith('.graphql') && !isKnownGraphQLFile(filePath)) return false;
if ((filePath.endsWith('.yml') || filePath.endsWith('.yaml')) && !isKnownYAMLFile(filePath)) return false;
return true;
```
Replace with:
```ts
if (!isSupportedSourceFile(filePath)) return false;
return true;
```
Also drop the now-unused `isKnownLiquidFile`, `isKnownGraphQLFile`, `isKnownYAMLFile` imports.

**Caller 2 — `packages/platformos-language-server-common/src/documents/DocumentManager.ts:84-89`**

Current:
```ts
.filter(sourceCode => sourceCode.type !== SourceCodeType.LiquidHtml || isKnownLiquidFile(sourceCode.uri))
```
This only filters Liquid; GraphQL and YAML files outside known dirs slip through. Replace with `isSupportedSourceFile(sourceCode.uri)` so the LSP `app()` view matches what the CLI sees.

**Behavior change to note:** `DocumentManager.app()` will now drop graphql/yaml files that sit outside known dirs. If any LSP test depends on a misplaced fixture being included, update the fixture path.

**Files:**
- `packages/platformos-check-node/src/index.ts`
- `packages/platformos-language-server-common/src/documents/DocumentManager.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 platformos-check-node/src/index.ts uses isSupportedSourceFile and drops the three isKnown* imports
- [ ] #2 DocumentManager.app() uses isSupportedSourceFile uniformly
- [ ] #3 yarn build succeeds for both packages with no unused-import errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS DONE 2026-08-07

The hand-rolled extension filters are gone and the `isKnownLiquidFile` /
`isKnownGraphQLFile` / `isKnownYAMLFile` family was deleted. `platformos-common/CLAUDE.md`
records it: "the per-type `isLayout`/`isSms`/`isKnownLiquidFile`/… family was deleted
once every caller had moved to `context.fileType` or `AppFile.fileType`."

The only surviving mentions anywhere in the repo are historical comments in
`platformos-mcp-supervisor/src/impact/impact.ts` and
`platformos-check-common/src/fixed-path-files.spec.ts` explaining what the code used to
do. No call sites.

The specific call site this task named (`platformos-check-node/src/index.ts:144-163`)
no longer exists in that shape either: check-node builds its file set through the shared
`App` model.
<!-- SECTION:NOTES:END -->
