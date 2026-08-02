---
id: TASK-3
title: Rewrite isSupportedSourceFile to be type-driven
status: Done
assignee: []
created_date: '2026-05-11 13:09'
updated_date: '2026-08-02 09:51'
labels:
  - platformos-common
dependencies:
  - TASK-1
  - TASK-2
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stop dispatching `isSupportedSourceFile` on file extension first. The current
implementation (`path-utils.ts:397`) duplicates type-membership decisions across three
branches:

```ts
export function isSupportedSourceFile(uri: UriString): boolean {
  if (/\.(s?css|js)\.liquid$/.test(uri)) return false;
  if (uri.endsWith('.liquid')) return isKnownLiquidFile(uri);
  if (uri.endsWith('.graphql')) return isKnownGraphQLFile(uri);
  if (uri.endsWith('.yml') || uri.endsWith('.yaml')) return isKnownYAMLFile(uri);
  return false;
}
```

**Target behavior:**
```ts
export function isSupportedSourceFile(uri: UriString): boolean {
  // Asset partials are compiled by the backend but the linter cannot parse
  // them as Liquid — they are CSS/JS/SCSS templates.
  if (/\.(?:s?css|js)\.liquid$/.test(uri)) return false;
  const type = getFileType(uri);
  if (type === undefined) return false;
  if (LIQUID_FILE_TYPES.has(type))  return uri.endsWith('.liquid');
  if (GRAPHQL_FILE_TYPES.has(type)) return true; // extension enforced by classification
  if (YAML_FILE_TYPES.has(type))    return true; // extension enforced by classification
  return false; // Asset, the JSON manifests, …
}
```

**Why the `.liquid` gate stays for Liquid types:** backend `PHYSICAL_PATH` for `Page`
(`page.rb:7`) and `InstanceView` (`instance_view.rb:9`) is `(.+)` with no extension
anchor, so `app/views/pages/home.html` IS a deployed Page — the classification is
right and the linter still cannot parse it as Liquid. Note the gate only needs to
cover Page/Layout/Partial once TASK-1 lands; the other seven Liquid types anchor
`\.liquid\z` themselves. Leaving it as a blanket `LIQUID_FILE_TYPES` gate is fine and
cheaper to read than the precise version.

**Why GraphQL/YAML need no extension gate — ONLY AFTER TASK-1.** Today they are not
extension-anchored: `app/graphql/x.yml` classifies as GraphQL and this rewrite would
start returning `true` for it. That is the whole reason for the dependency; do not
land this first.

## Correction to the original ACs

The old AC #2 said this must return `false` for `InstanceConfig` and `UserType`. That
is now wrong: `app/config.yml` and `app/user.yml` are in `YAML_FILE_TYPES`, ARE
supported sources, and are deliberately visited by the linter — see
`platformos-check-common/src/fixed-path-files.spec.ts`, which pins that every YAML
check guards on the file TYPE so neither file attracts an offense. Keep them `true`.

**Files:**
- `packages/platformos-common/src/path-utils.ts`

**Cleanup:** `isKnownLiquidFile` / `isKnownGraphQLFile` / `isKnownYAMLFile` become thin
wrappers over `getFileType` + a set lookup. Their last non-spec caller outside this
file is `DocumentManager.ts:113` (TASK-4); once that is gone they are internal, and
TASK-3.1 decides whether they survive at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `isSupportedSourceFile` uses `getFileType` + type-set membership; no extension-based dispatch except the asset-partial skip and the Liquid `.liquid` gate
- [x] #2 Returns `false` for `Asset` and for every JSON type TASK-2 adds; returns `true` for `InstanceConfig` and `UserSchema`
- [x] #3 Returns `false` for `app/views/partials/foo.css.liquid` and `app/views/partials/foo.js.liquid`
- [x] #4 Returns `true` for `app/views/pages/home.liquid`, `false` for `app/views/pages/home.txt` and `false` for `app/graphql/x.yml`
- [x] #5 `GRAPHQL_FILE_TYPES` exists as a set beside the other two, rather than the single-type comparison `isKnownGraphQLFile` does today
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02, after TASK-1 as the dependency required.

`isSupportedSourceFile` is now:

    if (/\.(s?css|js)\.liquid$/.test(uri)) return false;
    const type = getFileType(uri);
    if (type === undefined) return false;
    if (LIQUID_FILE_TYPES.has(type)) return uri.endsWith('.liquid');
    return GRAPHQL_FILE_TYPES.has(type) || YAML_FILE_TYPES.has(type);

One extension test remains and it is load-bearing rather than duplicated: Page, Layout
and Partial deploy under any extension (`page.rb:7`, `instance_view.rb:9`), so
`app/views/pages/home.html` is a real Page the linter cannot read. Everything else
anchors its extension while classifying, so having the type IS having the extension.

Kept the blanket `LIQUID_FILE_TYPES` gate rather than narrowing it to the three
permissive types — the other six anchor `.liquid` themselves, so the check is
redundant for them but cheaper to read than the precise version.

`GRAPHQL_FILE_TYPES` added beside the other two sets; `isKnownGraphQLFile` now asks it
instead of comparing to a single enum value.

The old AC#2 was corrected before implementing: `app/config.yml` and `app/user.yml`
return TRUE. They are in `YAML_FILE_TYPES` and deliberately linted — pinned by
`check-common/src/fixed-path-files.spec.ts`.

Also fixed the adjacent stale doc on `isKnownYAMLFile`, which still claimed config
files return false.

52 new assertions in `path-utils.spec.ts` cover the true/false sets and the
classification-vs-readability split.
<!-- SECTION:NOTES:END -->
