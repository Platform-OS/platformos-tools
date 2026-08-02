---
id: TASK-12.28
title: >-
  VS Code documentSelectors has no yaml entry, so translation buffers never
  reach the language server
status: Done
assignee: []
created_date: '2026-08-01 12:50'
updated_date: '2026-08-01 18:00'
labels:
  - architecture
  - vscode-extension
  - language-server
dependencies: []
parent_task_id: TASK-12
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while implementing TASK-12.27 (2026-08-01), which made every other place derive the source
extension list from platformos-common's SOURCE_FILE_EXTENSIONS / SOURCE_FILE_GLOB.

`packages/vscode-extension/src/common/constants.ts`'s `documentSelectors` is the one remaining
copy, and it is a KNOWN offender in `directory-knowledge.spec.ts`'s new source-extension rule.
It cannot be derived mechanically — each glob is paired with a VS Code LANGUAGE ID, and ids do
not map one-to-one onto extensions (`yml` and `yaml` are both the `yaml` language) — so it
needs its own change rather than the mechanical substitution the other three places got.

Two problems in it:

1. There is NO yaml entry at all. VS Code therefore never forwards a translation, table,
   user-profile-type or transactable-type buffer to the language server: no diagnostics, no
   completions, no go-to-definition on any .yml source. The server side is now ready for them
   (TASK-12.27 widened both the didRename filter and the file watcher to SOURCE_FILE_GLOB).
2. The json/jsonc entries are dead Shopify leftovers:
   `'**/{config,locales,sections,templates}/**/*.json'`. platformOS has no sections or
   templates, and JSON is served from .json.liquid. Confirm what JSONLanguageService is still
   for before deleting.

Care needed on (1): a bare `{ language: 'yaml', pattern: <recursive yml/yaml glob> }` forwards
EVERY yaml buffer in the workspace — .github/workflows/ci.yml, docker-compose.yml — to the
server, which will open, parse and lint them. Check what the YAML checks do with a file
`getFileType` does not classify before widening, and narrow the pattern if they misbehave.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 documentSelectors forwards .yml/.yaml platformOS sources to the language server, and opening a translation file produces diagnostics
- [x] #2 a non-platformOS yaml file (e.g. .github/workflows/ci.yml) produces no offenses when opened
- [x] #3 the json/jsonc selectors are either justified in a comment or removed
- [x] #4 vscode-extension is removed from KNOWN in directory-knowledge.spec.ts, or its remaining entry has a reason that is not the yaml gap
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-01.

`documentSelectors` no longer spells the extension list at all: it maps over
`SOURCE_FILE_EXTENSIONS` from platformos-common and keeps only the two facts that are
genuinely VS Code's rather than the platform's.

1. **Language ids.** `LANGUAGE_ID_BY_EXTENSION` is a one-entry map (`yml` -> `yaml`);
   every other extension is its own id. That is the whole reason this file looked
   underivable, and it is one line.
2. **Which extensions need anchoring.** `.yml`/`.yaml` are anchored to
   `**/{app,marketplace_builder,modules}/**`, derived from the first segment of each
   `APP_SOURCE_SUBTREES` entry. Liquid and GraphQL stay unanchored: a `.liquid` file is
   a platformOS file wherever it sits, and narrowing it would silently take diagnostics
   away from anyone with a file outside a recognised subtree — a change this task did
   not ask for.

The anchor is deliberately looser than the lint's walk, which anchors at the project
ROOT (so `tmp/app/…` is excluded). A `DocumentFilter.pattern` is a plain glob matched
against the whole path with no workspace anchor available in a static constant, so
first-segment-at-any-depth is as tight as it gets. It costs nothing: both YAML checks
(`MatchingTranslations`, `ValidHTMLTranslation`) return early unless
`getFileType(uri) === Translation`, so a stray `tmp/app/x.yml` produces no offenses even
if it is forwarded.

### json / jsonc: removed (AC #3)

They selected `{config,locales,sections,templates}/**/*.json` — Shopify's layout.
platformOS has no sections and no templates, and serves JSON from `.json.liquid`, so a
`.json` file is an asset. They were also inert: `JSONLanguageService` only builds its
service `if (schemas.length)`, and the platformOS docset's `schemas()` is
`memo(async () => [])` ("platformOS does not use JSON schemas"), so its completions,
hover and document links could never fire. Reasoning left in the file so it does not
come back.

### Evidence

- AC #1, client half: new `constants.spec.ts` asserts the whole selector array, and
  that `app/translations/en.yml`, `app/translations/en/admin.yaml`,
  `modules/core/public/translations/en.yml` and
  `marketplace_builder/user_profile_types/default.yml` are all selected.
- AC #1, server half: already covered — `runChecks.spec.ts` opens `app/translations/fr.yml`
  as a buffer and asserts the `MatchingTranslations` diagnostic it produces. The gap was
  only ever that VS Code never sent the buffer.
- AC #2: `.github/workflows/ci.yml`, `docker-compose.yml` and `config/database.yml` are
  each asserted NOT selected.
- AC #4: `KNOWN` in `directory-knowledge.spec.ts` is now empty — no file outside
  platformos-common spells a list of source extensions.

`minimatch@^10.2.2` added to vscode-extension's devDependencies for the pattern tests.
`yarn.lock` needed no change (check-common already locks that range) and
`yarn install --frozen-lockfile` passes.

Suites: 2627 tests, 294 files, all green; monorepo build, type-check and the
vscode-extension webpack bundle all clean.

### Not done here

The `css` selector (`**/assets/**/*.css`) is still hand-written, correctly: `.css` is an
asset extension, not a source one, so it is not in `SOURCE_FILE_EXTENSIONS` and this
file is the right place to know about it.
<!-- SECTION:NOTES:END -->
