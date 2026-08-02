---
id: TASK-2
title: Classify the remaining fixed-path files and the two ActivityStreams types
status: Done
assignee: []
created_date: '2026-05-11 13:02'
updated_date: '2026-08-02 09:51'
labels:
  - platformos-common
dependencies:
  - TASK-1
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewritten 2026-08-02. Two of the seven types this task asked for shipped on the
`app-in-memory-lazy-parsing` branch, under a mechanism that did not exist when the task
was written. Five are still missing.

## Already done

| asked for | shipped as | where |
|---|---|---|
| `InstanceConfig` | `PlatformOSFileType.InstanceConfig` | `FILE_TYPE_FILES` |
| `UserType` | `PlatformOSFileType.UserSchema` (renamed) | `FILE_TYPE_FILES` |

The mechanism is `FILE_TYPE_FILES` (`path-utils.ts:99`) — "the types that are ONE FILE
at a fixed path rather than a directory of files" — plus `isFixedPathFileType`,
`getFixedFilePath`, a `FILE_MATCHERS` pass in `getFileType`, a string-compare branch at
the top of `parseAppPath`, and a `fixedNameOf` branch in `nameToPaths`. So there is no
`SCALAR_MATCHERS` table to add and no `BACKEND_MODELS` table to extend; both halves of
the original design are superseded.

## Still missing

- `AssetManifest` — `\A#{DIR_PREFIX_WITHOUT_MODULES}asset_manifest\.json`
  (`converters_config.rb:80`). App-scoped, so `FILE_TYPE_FILES` fits it as-is.
- `AssetsManifest` — `\A#{DIR_PREFIX}assets\.json` (`converters_config.rb:76`).
  **Does not fit `FILE_TYPE_FILES` as built**: that mechanism is deliberately
  app-scoped ("there is no `modules/<name>/{public,private}/config.yml`", and
  `FILE_MATCHERS` hardcodes `/(app|marketplace_builder)/`). This one uses the full
  `DIR_PREFIX`, so `modules/core/public/assets.json` is real. Either widen
  `FILE_TYPE_FILES` entries with a "module form allowed" flag, or give this one type
  its own matcher and say why.
- `ModulesLock` — `modules_converter.rb:15`:
  `^/?(?:(?:marketplace_builder/|app/)?pos-modules\.lock\.json|pos-module\.lock\.json)$`.
  Note the two spellings differ: `pos-modules.lock.json` takes an optional app root,
  `pos-module.lock.json` (singular) is root-level ONLY. Mirror that, do not tidy it.
- `ActivityStreamsHandler` — `activity_streams/handlers/(.+)\.yml\z`
  (`activity_streams/handler.rb:7`). Ordinary directory type: one `FILE_TYPE_DIRS` row.
- `ActivityStreamsGroupingHandler` — `activity_streams/grouping_handlers/(.+)\.yml\z`
  (`activity_streams/grouping_handler.rb:7`). Same.

Both ActivityStreams directories are nested two deep, which `FILE_TYPE_DIRS` already
supports (`notifications/email_notifications`), and both enforce `.yml` — so they need
TASK-1's extension rule, which is why the dependency stands.

## The JSON question this task has to answer

`app/types.ts` states the package's position outright: "a platformOS app has no JSON
source type … the only `.json` files the platform deploys are the two fixed asset
manifests, which no check looks at. A stray `.json` file is therefore an asset."
Adding `AssetManifest` / `AssetsManifest` / `ModulesLock` makes that comment wrong in
its details while leaving it right in substance: they get a `PlatformOSFileType` and no
`SourceCodeType`, so nothing parses them and no check runs on them.

Decide and record WHY they are worth classifying at all, given nothing lints them. The
honest candidates are: the watcher/`SOURCE_FILE_GLOB` story, `MissingAsset` resolving
through a manifest, and "the enum is a model of what the platform deploys". If none of
those pays, close this half of the task instead of shipping dead enum values.

## Files

- `packages/platformos-common/src/path-utils.ts`
- `packages/platformos-common/src/app/AppFile.ts` (`FILE_CLASS_BY_TYPE` needs a row per
  new type — it is exhaustive over the enum)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ActivityStreamsHandler` and `ActivityStreamsGroupingHandler` classify under `app/`, `marketplace_builder/`, `modules/<name>/{public,private}/` and `app/modules/…`, enforce `.yml`, and are in `YAML_FILE_TYPES`
- [x] #2 It is decided and recorded whether `AssetManifest` / `AssetsManifest` / `ModulesLock` are worth classifying when nothing parses or lints them; if no, that half is closed rather than shipped
- [ ] #3 If they ship: `app/asset_manifest.json`, `app/assets.json`, `modules/core/public/assets.json`, `pos-modules.lock.json`, `app/pos-modules.lock.json` and `pos-module.lock.json` all classify, and `modules/core/public/pos-module.lock.json` does NOT
- [x] #4 Each new type carries a comment naming the backend file:line it mirrors, and `FILE_CLASS_BY_TYPE` in AppFile.ts covers it
- [x] #5 No new type gets a `SourceCodeType`, so nothing attempts to parse it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02. Split as the description proposed: ActivityStreams shipped, the JSON half is closed.

## Shipped

`ActivityStreamsHandler` and `ActivityStreamsGroupingHandler`, as ordinary directory
types — one `FILE_TYPE_DIRS` row each (`activity_streams/handlers`,
`activity_streams/grouping_handlers`, nested two deep like
`notifications/email_notifications`), `.yml` via `REFERENCE_EXTENSIONS`, both in
`YAML_FILE_TYPES`, both mapped to `YamlFile` in `FILE_CLASS_BY_TYPE`. They classify
under app/, marketplace_builder/, modules/<name>/{public,private}/ and app/modules/…,
and reject `.json` / `.yaml`. Backend refs: `activity_streams/handler.rb:5,7` and
`grouping_handler.rb:5,7`.

## AC#2 — decided: AssetManifest / AssetsManifest / ModulesLock are NOT classified

User decision, and pos-cli confirms the reasoning. These are GENERATED artifacts, not
authored source:

- `pos-module.lock.json` / `app/pos-modules.lock.json` are written by pos-cli's module
  installer (`~/projects/js/pos-cli/lib/modules/paths.js`).
- `assets.json` / `asset_manifest.json` are not pos-cli's at all — it has no reference
  to either. They come from the project's own JS build (htevent has one).

Nothing lints a generated file. Classifying them would have bought three enum values
with no `SourceCodeType`, no parser, no check and no consumer, plus a special case in
`FILE_TYPE_FILES` for `assets.json`'s module form, which that mechanism is
deliberately app-scoped to exclude. `app/types.ts`'s standing position — "a platformOS
app has no JSON source type" — is left intact and correct.

AC#3 is therefore not applicable.

## Verified

377 tests in platformos-common (was 325); full monorepo 2700 green. No change to the
App file set on pos-module-community, arabbank, Accala-MP or htevent — none of them
uses activity_streams.
<!-- SECTION:NOTES:END -->
