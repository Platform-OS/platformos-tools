---
id: TASK-2
title: Add scalar-pattern + ActivityStreams file types
status: Done
assignee: []
created_date: '2026-05-11 13:02'
updated_date: '2026-08-07 12:51'
labels: []
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add new `PlatformOSFileType` enum values for files that converters_config.rb matches with scalar/literal patterns rather than per-model FULL_PHYSICAL_PATH, plus the two ActivityStreams subtypes the backend dispatches.

**New enum values:**
- `InstanceConfig` — `^/?(app/)?config\.yml$` (drops marketplace_builder)
- `UserType` — `\A(app/)?user\.yml`
- `AssetManifest` — `\A(app/)?asset_manifest\.json`
- `AssetsManifest` — `\A(app/|modules/(.+)(private|public)/)assets\.json`
- `ModulesLock` — `^/?(?:(?:app/)?pos-modules\.lock\.json|pos-module\.lock\.json)$`
- `ActivityStreamsHandler` — `activity_streams/handlers/(.+)\.yml`
- `ActivityStreamsGroupingHandler` — `activity_streams/grouping_handlers/(.+)\.yml`

**Source:** `converters_config.rb` lines 7–22 (scalar patterns) plus `app/models/activity_streams/handler.rb` and `app/models/activity_streams/grouping_handler.rb`.

**Design notes:**
- ActivityStreams types extend the `BACKEND_MODELS` table from task 1 (they have normal `PHYSICAL_PATH`).
- Scalar patterns live in a small separate `SCALAR_MATCHERS` table. `getFileType` consults `TYPE_MATCHERS` first, then `SCALAR_MATCHERS`.
- Add `ActivityStreamsHandler` and `ActivityStreamsGroupingHandler` to `YAML_FILE_TYPES`.
- Scalar JSON types (`AssetManifest`, `AssetsManifest`, `ModulesLock`) get classified but are NOT in `YAML_FILE_TYPES` — `isSupportedSourceFile` returns false for them (no JSON checks yet).

**Files:**
- `packages/platformos-common/src/path-utils.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Seven new PlatformOSFileType enum values added with backend file:line references
- [ ] #2 getFileType correctly classifies: config.yml, app/config.yml, user.yml, app/user.yml, asset_manifest.json, app/asset_manifest.json, app/assets.json, modules/core/public/assets.json, pos-modules.lock.json, pos-module.lock.json, app/pos-modules.lock.json
- [ ] #3 ActivityStreamsHandler and ActivityStreamsGroupingHandler classify under app/, modules/, and app/modules/ roots
- [ ] #4 YAML_FILE_TYPES set updated to include ActivityStreamsHandler and ActivityStreamsGroupingHandler
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS OBSOLETE 2026-08-07 — partly done, partly declined on purpose

Checked each proposed enum value against `platformos-common/src/path-utils.ts`:

| Proposed | Status |
|---|---|
| `InstanceConfig` | **exists** |
| `UserType` | **exists, renamed `UserSchema`** |
| `ActivityStreamsHandler` | **exists** |
| `ActivityStreamsGroupingHandler` | **exists** |
| `AssetManifest` | **declined** |
| `AssetsManifest` | **declined** |
| `ModulesLock` | **declined** |

The three `.json` types were not an oversight. The toolchain has no JSON source type at
all — `SOURCE_CODE_TYPE_BY_KEY` has no `.json` row, and `platformos-common/CLAUDE.md`
states the reason: "the only `.json` files the platform deploys are generated manifests
no check looks at. Ruby's `App::REGEXP_MAP` agrees." Adding classifications for files
nothing reads would create types with no checks, which is the failure mode
`file-type-coverage.spec.ts` exists to catch.

The `SCALAR_MATCHERS` design in the description is also superseded: fixed-path files are
handled by `FILE_TYPE_FILES` + `getFixedFilePath`, checked ahead of the directory
patterns inside `parseAppPath`.
<!-- SECTION:NOTES:END -->
