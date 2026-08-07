---
id: TASK-1
title: Mirror backend FULL_PHYSICAL_PATH regexps in path-utils.ts
status: Done
assignee: []
created_date: '2026-05-11 12:48'
updated_date: '2026-08-07 12:50'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the current FILE_TYPE_DIRS + TYPE_MATCHERS in `packages/platformos-common/src/path-utils.ts` with a declarative table that is a 1:1 mirror of the backend `converters_config.rb` regexps. The linter must classify a file iff the backend would dispatch that file to a converter.

**Source of truth:** `desksnearme/app/services/app_builder/services/converters_config.rb` plus per-model `PATH_DIRECTORY` / `EXTENSION` / `PHYSICAL_PATH` constants under `desksnearme/app/models/`. Helpful header is `desksnearme/app/models/concerns/deployable.rb` (lines 20–22) which builds `FULL_PHYSICAL_PATH = \A + DIR_PREFIX + PHYSICAL_PATH`.

**Scope:**
- Drop `marketplace_builder` support entirely (user-approved). Only `app/` and `modules/{name}/{access}/` (plus optional `app/modules/{name}/{access}/`).
- Replace the dir-name-only matchers with full FULL_PHYSICAL_PATH regexps. This catches wrong extensions (e.g. `app/translations/en.json` → undefined) the way the backend does.
- Keep `getFileType`, `getAppPaths`, `getModulePaths` signatures stable; re-derive their data from a single `BACKEND_MODELS` table.
- Mirror backend quirks verbatim with `// backend quirk:` comments: GraphQuery `(graph_queries|graphql)s?` and DIR_PREFIX `modules/(.+)(private|public)/` missing-slash shape.
- Update `RouteTable.extractRelativePagePath` to drop the `marketplace_builder` alternative.

**Files:**
- `packages/platformos-common/src/path-utils.ts`
- `packages/platformos-common/src/route-table/RouteTable.ts` (drop `marketplace_builder` from regex)
- `packages/platformos-common/CLAUDE.md` (update architecture note)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BACKEND_MODELS table mirrors every row in converters_config.rb (Page, InstanceView Page/Layout/Partial split, GraphQuery, AuthorizationPolicy, EmailNotification, ApiCallNotification, SmsNotification, DataMigration, FormConfiguration, Translation, TransactableType, CustomModelType, InstanceProfileType, Asset)
- [ ] #2 DIR_PREFIX accepts only: empty | app/ | modules/{name}/{public|private}/ | app/modules/{name}/{public|private}/. marketplace_builder removed everywhere
- [ ] #3 FULL_PHYSICAL_PATH regex includes the extension suffix where the backend enforces it (.liquid for Liquid types, .graphql for GraphQL, .yml for YAML types)
- [ ] #4 Each BACKEND_MODELS row carries a comment pointing to the exact backend model file:line it mirrors
- [ ] #5 RouteTable.extractRelativePagePath drops the marketplace_builder regex alternative
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## CLOSED AS OBSOLETE 2026-08-07 — goal met, two instructions since reversed

Verified against the code, not assumed.

**Achieved by other means.** `TYPE_MATCHERS` no longer exists anywhere in
`platformos-common/src` — the dir-name-only matcher was deleted and `PATH_PATTERNS` now
compiles one ANCHORED regex per (type, dir) pair with the extension in it, which is
exactly what this task asked for. `app/translations/en.json` classifies as nothing,
`app/graphql/x.yml` as nothing. `parseAppPath` is the anchored resolver.

**Two of this task's instructions were later deliberately REVERSED, which is why leaving
it open is worse than closing it — someone picking it up would undo working behaviour:**

1. *"Drop `marketplace_builder` support entirely (user-approved)."* It was kept.
   `APP_ROOTS = ['app', 'marketplace_builder']`, with the reason recorded at the
   constant: "dropping a live root makes a project on it lint nothing at all, silently."
2. The `RouteTable.extractRelativePagePath` change followed the same reversal.

**Superseded by** the file-identity work in TASK-59/59.1 and the lazy-`App` epic
(TASK-46), both archived. The current design is documented in
`packages/platformos-common/CLAUDE.md` under "path-utils.ts — File type classification".

Siblings TASK-2 … TASK-6 closed with it; see each for its own disposition.
<!-- SECTION:NOTES:END -->
