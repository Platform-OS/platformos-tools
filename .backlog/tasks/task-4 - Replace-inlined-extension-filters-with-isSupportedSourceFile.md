---
id: TASK-4
title: Replace inlined extension filters with isSupportedSourceFile
status: To Do
assignee: []
created_date: '2026-05-11 13:10'
labels: []
dependencies:
  - TASK-3
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
