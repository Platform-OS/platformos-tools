---
id: TASK-3
title: Rewrite isSupportedSourceFile to be type-driven
status: Done
assignee: []
created_date: '2026-05-11 13:09'
updated_date: '2026-08-07 12:51'
labels: []
dependencies: []
ordinal: 3000
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS OBSOLETE 2026-08-07 — done, and the prescribed code is now an anti-pattern

`isSupportedSourceFile` is type-driven. It is the intersection of three questions, with
no extension dispatch:

```ts
const type = getFileType(uri, rootUri);
return type !== undefined && isParsedFileType(type) && sourceCodeTypeOf(uri) !== undefined;
```

**Two things in this task's target snippet are now actively wrong**, which is why
closing it beats leaving it open:

1. It shows `isSupportedSourceFile(uri: UriString)`. The real signature takes
   `(uri, rootUri)` — anchoring is the point, because an unanchored classifier can only
   ask whether a known directory name appears somewhere in the string, and
   `seed/post_import/app/migrations/x.liquid` is not a migration.
2. It opens with `if (/\.(?:s?css|js)\.liquid$/.test(uri)) return false;`. That
   ignore-list existed and was REMOVED, and `platformos-common/CLAUDE.md` now says
   "**Do not add an exclusion list here**" with the incident: the language server
   honoured the list while the lint went through `App.fromPaths` and reported
   `LiquidHTMLSyntaxError` on the same file. Unparseable is now expressed as absence
   from `SOURCE_CODE_TYPE_BY_KEY`, because absence cannot be forgotten.

AC #2 also names `AssetManifest` / `AssetsManifest` / `ModulesLock`, which were
deliberately never added — see TASK-2.
<!-- SECTION:NOTES:END -->
