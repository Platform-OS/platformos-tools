---
id: TASK-12.27
title: >-
  Three places outside platformos-common still decide what a platformOS source
  file is
status: Done
assignee: []
created_date: '2026-08-01 09:47'
updated_date: '2026-08-01 12:50'
labels:
  - architecture
  - language-server
  - platformos-graph
  - check-common
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raised while implementing TASK-12.22 (2026-08-01), which removed the fourth: check-node's
`getAppFilePaths` no longer classifies at all — it globs candidates by
`SOURCE_FILE_EXTENSIONS` and lets `App.fromPaths`/`parseAppPath` decide what is an app
file. That is the shape the rest should take.

`directory-knowledge.spec.ts` already forbids a second copy of a platformOS DIRECTORY
name outside `platformos-common`. It does not yet police the other two facts about a
file the platform owns: which EXTENSIONS are sources, and which parser/`SourceCodeType`
each one gets. Three remaining copies:

1. `platformos-language-server-common/src/server/startServer.ts` — the file-operation
   filter glob is `'**/*.{liquid,json,graphql}'`: it misses `.yml`/`.yaml` (so renaming a
   translation file is not handled) and still lists `json`, which is not a platformOS
   source at all. Should be built from `SOURCE_FILE_EXTENSIONS`.
2. `platformos-check-common/src/to-source-code.ts` — maps extension → `SourceCodeType`
   with its own `endsWith('.liquid')` / `.graphql` / `.yml` / `.yaml` chain. `AppFile`
   already derives the same thing from the file TYPE. Either export the mapping from
   `platformos-common` and have `toSourceCode` call it, or retire the function as
   TASK-12.6.4/12.6.5 replace its callers.
3. `platformos-graph/src/graph/build.ts` — filters the walk to `.liquid`. Worth
   confirming this is a graph-domain choice (only Liquid has references to traverse)
   rather than a fourth answer to "what is a source file"; document it either way.

Cheap enforcement once they are gone: extend `directory-knowledge.spec.ts` to also fail
on a source EXTENSION list spelled outside `platformos-common`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 startServer's file-operation glob is derived from SOURCE_FILE_EXTENSIONS, and renaming a .yml translation is handled
- [x] #2 toSourceCode no longer maps extensions to SourceCodeType itself, or the decision to keep it is written down with a reason
- [x] #3 graph/build.ts's .liquid filter is either derived from platformos-common or documented as a traversal choice
- [x] #4 directory-knowledge.spec.ts fails when a source extension list is spelled outside platformos-common
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-01.

New in platformos-common: `SOURCE_FILE_GLOB` (path-utils.ts), `SOURCE_FILE_EXTENSIONS` in
brace-expansion form. Every walker and watcher joins it onto its own root instead of spelling
the list. `sourceCodeTypeOf` (app/types.ts) already existed and is now the only extension →
SourceCodeType map.

1. startServer.ts — didRename filter is `SOURCE_FILE_GLOB` (was `'**/*.{liquid,json,graphql}'`,
   which listed json and dropped yml/yaml). Also collapsed the file WATCHER list, which had the
   same defect in a different shape: `**/*.liquid` + `**/translations/**/*.yml` + `**/*.graphql`
   + `**/app/config.yml` became `SOURCE_FILE_GLOB` + `**/*.css`. That was in scope for AC #4 —
   it is a source-extension list in the same file — and it fixes the same class of gap for
   .yaml translations and non-config YAML sources (tables, user profile types, transactable
   types), which nothing watched. Two new tests in startServer.spec.ts pin both globs.
2. to-source-code.ts — switches on `sourceCodeTypeOf(uri)` instead of its own endsWith chain.
   KEPT the JSON default, documented: it is an EDITOR fallback for DocumentManager, which holds
   every buffer the editor opens, not a classification. App still contains no JSON file.
   Behaviour is identical except that extensions now match case-insensitively.
3. graph/build.ts — the .liquid entry-point filter is `sourceCodeTypeOf(uri) === LiquidHtml`,
   with a comment that this is a graph-domain restriction (only Liquid can reference another
   file) and not a second answer to what a source file is. Also fixed the fourth copy the task
   did not name: graph/toSourceCode.ts's `extension === 'json' || 'liquid' || 'graphql' ||
   'yml' || 'yaml'` chain.
4. directory-knowledge.spec.ts — new describe block, 'platformOS source-extension knowledge
   lives only in platformos-common'. Rule: two or more DISTINCT source extensions spelled in one
   non-exempt file. Looser than the directory rule on purpose — a single .liquid is legitimate
   (a traversal restriction, a `${name}.liquid` candidate, `.platformos-check.yml`); a LIST is
   always someone re-deriving what a platformOS source is. Only extension-SHAPED spellings count
   (dotted-extension-ending-a-string/regex, and brace-expansion members); a bare `'liquid'` is
   not one, because it is also the {% liquid %} tag name, 'graphql' a node kind and a VS Code
   language id, 'yaml' an npm package. json is not policed — package.json/tsconfig.json make it
   unusable as a signal. Verified the guard fails on an injected violation.

KNOWN has one entry: vscode-extension/src/common/constants.ts. Its documentSelectors pair globs
with VS Code LANGUAGE IDs, which do not map one-to-one onto extensions, so it cannot be derived
mechanically — and it has a real bug (no yaml entry at all, so VS Code never forwards a
translation buffer to the server) that needs its own change. Filed as TASK-12.28.

yarn build, yarn type-check and yarn test all clean: 292 files / 2608 tests.
<!-- SECTION:NOTES:END -->
