---
id: TASK-3
title: Rewrite isSupportedSourceFile to be type-driven
status: To Do
assignee: []
created_date: '2026-05-11 13:09'
labels: []
dependencies:
  - TASK-2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stop dispatching `isSupportedSourceFile` on file extension first. The current implementation in `packages/platformos-common/src/path-utils.ts` (line 273) duplicates type-membership decisions across three branches. After tasks 1+2 land, replace it with a single type-driven decision that defers to `getFileType` and the LIQUID/GRAPHQL/YAML sets.

**Target behavior:**
```ts
export function isSupportedSourceFile(uri: UriString): boolean {
  // Asset partials are compiled by the backend but the linter cannot parse
  // them as Liquid — they are CSS/JS/SCSS templates.
  if (/\.(?:s?css|js)\.liquid$/.test(uri)) return false;
  const type = getFileType(uri);
  if (type === undefined) return false;
  if (LIQUID_FILE_TYPES.has(type))  return uri.endsWith('.liquid');
  if (GRAPHQL_FILE_TYPES.has(type)) return true; // extension enforced by FULL_PHYSICAL_PATH
  if (YAML_FILE_TYPES.has(type))    return true; // extension enforced by FULL_PHYSICAL_PATH
  return false; // Asset, scalar JSON types, etc.
}
```

**Why the `.liquid` gate stays for Liquid types:** backend `PHYSICAL_PATH` for `Page` and `InstanceView` accepts any extension (`(.+)` with no `\.liquid\z` anchor), so the regex alone is not enough to know whether the linter can parse it.

**Why GraphQL/YAML don't need an extension gate:** their FULL_PHYSICAL_PATH already enforces `\.graphql\z` or `\.yml\z`.

**Files:**
- `packages/platformos-common/src/path-utils.ts`

**Optional cleanup:** `isKnownLiquidFile`, `isKnownGraphQLFile`, `isKnownYAMLFile` become thin wrappers over `getFileType` + a type-set lookup. Keep exported for back-compat; mark `isSupportedSourceFile` as preferred.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 isSupportedSourceFile uses getFileType + type-set membership; no extension-based dispatch except the asset-partial skip and the Page/InstanceView .liquid gate
- [ ] #2 Returns false for Asset, AssetManifest, AssetsManifest, ModulesLock, InstanceConfig, UserType
- [ ] #3 Returns false for app/views/partials/foo.css.liquid (asset partial in known dir)
- [ ] #4 Returns true for app/views/pages/home.liquid and false for app/views/pages/home.txt
<!-- AC:END -->
