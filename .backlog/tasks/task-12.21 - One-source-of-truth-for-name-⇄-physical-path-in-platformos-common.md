---
id: TASK-12.21
title: One source of truth for name ⇄ physical path in platformos-common
status: Done
assignee: []
created_date: '2026-07-31 20:42'
updated_date: '2026-08-01 09:26'
labels:
  - platformos-common
  - architecture
dependencies: []
parent_task_id: TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DONE. Filed for the record because it closed a shipped bug and now carries the
invariant that prevents its class.

## Why

`platformos-graph` resolved `{{ 'app.js' | asset_url }}` to a root-level
`assets/app.js` — a location the platform does not deploy from — while
`DocumentsLocator` resolved the same reference to `app/assets/app.js`. Nothing failed,
because each had its own copy of the reference→path rule and neither was ever checked
against the other. Assets follow exactly the same placement rules as every other type:
`app/assets/` or `modules/<name>/{public,private}/assets/`.

Both directions of the mapping now live in `platformos-common`, and are tested to be
inverses.

## API

| | |
|---|---|
| `pathToName(relativePath)` | → `{ fileType, name, moduleName }`. `AppFile#name` delegates to it. |
| `nameToPaths(fileType, name)` | → every candidate path **in resolution order**, extension included. |
| `nameToCreationPath(fileType, name, dirIndex)` | → where a file WOULD be created. |
| `getFixedFilePath(type)` | → the one path of a fixed-path type (`app/config.yml`). |

Resolution order is app/modules overwrite → modules original, public → private,
`FILE_TYPE_DIRS` alias order. It is the same order `AppPathInfo.searchPathIndex`
encodes, so `App.find`, `DocumentsLocator`'s walk and `nameToPaths` cannot disagree.

**Creation is deliberately a different question from resolution.** `nameToPaths[0]` is
the app/modules OVERWRITE slot, because an overwrite shadows the original — right for
finding a file, wrong for creating one, since a new module file belongs in the module.
And `function` lands in `app/lib` while `render` lands in `app/views/partials` though
both are Partials. Flattening these into `nameToPaths[0]` broke four existing
`locateDefault` tests, which is how the distinction was found.

## The invariant

`name-path-roundtrip.spec.ts`: for every type × every directory alias × both module
roots × both access levels × nested paths, `nameToPaths(pathToName(p).name)` must
contain `p`. 15 tests.

## Callers migrated

`DocumentsLocator.locateFile` + `locateDefault`, `graph`'s `getAssetModule` (plus a new
`getAssetModuleByUri`, following the existing `…ByUri` precedent) and
`getPartialModule`, `valid-frontmatter`'s layout check, and the language server's
`FrontmatterDefinitionProvider`. The graph's `fixtures/skeleton/assets/` moved to
`app/assets/` — its two asset nodes now report `exists: true`, where before they were
only "correct" because the fixture matched the bug.

## Enforcement

`directory-knowledge.spec.ts` fails if any package outside `platformos-common` spells a
platformOS directory name, in either a path fragment (`'app/views/layouts'`) or
segment-wise (`joinPath(root, 'app', 'views', 'layouts')`). Offender list is empty.
Root-agnostic watch globs (`'**/assets/*'`) are exempt and documented as such: a `**/`
prefix matches the directory under every legal root, so it cannot disagree.

## Known asymmetry, NOT resolved

A layout `application.html.liquid` is referenced as `application`, but `pathToName`
gives `application.html`, so `nameToPaths('application')` does not offer it.
`valid-frontmatter` keeps its existing two-spelling probe (`.liquid`, then
`.html.liquid`), commented at the probe site. Making a format-less reference match a
format-suffixed file belongs in `nameToPaths` if it is the real rule — it would change
resolution for partials too, so it needs a deliberate decision rather than a guess.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pathToName and nameToPaths are proven inverses over every type, directory alias, module root and access level
- [ ] #2 No package outside platformos-common spells a platformOS directory name, enforced by a test
- [ ] #3 The graph and DocumentsLocator resolve the same reference to the same URI
- [ ] #4 Whether a format-less reference should match a format-suffixed file is decided and either implemented in nameToPaths or documented as out of scope
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Follow-up landed: current names, current canonical directories

- `PlatformOSFileType.CustomModelType` → **`Table`**. Tables are what the platform calls
  them now, and they live in `schema/`
  (https://documentation.platformos.com/developer-guide/records/records-tables:
  "Tables are placed in the `schema` directory").
- `PlatformOSFileType.InstanceProfileType` → **`UserProfileType`**.

Both also had a LEGACY directory first in `FILE_TYPE_DIRS`, which mattered once
`nameToPaths[0]` became "the canonical location" and `nameToCreationPath` started
offering it:

| Type | was canonical | now canonical | legacy aliases kept |
|---|---|---|---|
| `Table` | `custom_model_types` | **`schema`** | `custom_model_types`, `model_schemas` |
| `UserProfileType` | `instance_profile_types` | **`user_profile_types`** | `instance_profile_types`, `user_profile_schemas` |

The aliases are load-bearing, not theoretical: arabbank has 49 Tables under
`app/model_schemas`. Only the order changed.

## Also landed: the format-suffix rule

`pathToName` strips a known response format for Layout and Partial, so the documented
example layout `views/layouts/1col.html.liquid` is reachable as `1col` — it previously
produced the name `1col.html` and `App.find(Layout, '1col')` returned nothing.

`Page` is excluded: `api/users.json.liquid` and `api/users.liquid` are different routes,
so collapsing their names would make them collide. Only KNOWN formats strip, so a
partial named `user.avatar.liquid` keeps its dot.

`nameToPaths` offers the plain and `.html` spellings back, bounded deliberately: the
walk `stat`s each candidate, and enumerating all twelve known formats would turn one
unresolved `{% render %}` into 26 filesystem calls. `pathToName` is NOT bounded — it
strips any known format — so the App index resolves a `1col.json.liquid` layout that the
walk would miss. That is the right way round: the index is the primary resolver.

AC #4 (the format asymmetry) is now met.
<!-- SECTION:NOTES:END -->
