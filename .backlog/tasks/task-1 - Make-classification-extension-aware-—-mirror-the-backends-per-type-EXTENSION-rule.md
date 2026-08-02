---
id: TASK-1
title: >-
  Make classification extension-aware — mirror the backend's per-type EXTENSION
  rule
status: Done
assignee: []
created_date: '2026-05-11 12:48'
updated_date: '2026-08-02 09:50'
labels:
  - platformos-common
  - correctness
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rewritten 2026-08-02 against the code the `app-in-memory-lazy-parsing` branch actually
shipped. The original plan — replace `FILE_TYPE_DIRS` + `TYPE_MATCHERS` with a
`BACKEND_MODELS` regexp table — is no longer available and no longer needed. What the
task was FOR is still open.

## What changed under it

`FILE_TYPE_DIRS` is now load-bearing for far more than classification: `nameToPaths`,
`getAppPaths`, `getModulePaths`, `nameToCreationPath`, `App`'s per-type name index and
`AppPathInfo.searchPathIndex` all derive from it. Swapping it for a table of opaque
FULL_PHYSICAL_PATH regexps would take the name ⇄ path machinery down with it. The
anchored classifier the original task wanted already exists as `parseAppPath`
(TASK-12.6.1), and TASK-1.1 made it the App's only classifier.

So this is now an ADDITION to the existing derivation, not a replacement of it.

## What is still broken

A known directory is enough to classify; the extension is never consulted. Probed
against the built `dist` on 2026-08-02:

    app/graphql/x.yml                → GraphQL          (backend: not deployed)
    app/translations/en.json         → Translation      (backend: not deployed)
    app/transactable_types/x.yml.bak → TransactableType (backend: not deployed)

`isSupportedSourceFile` masks all three today with its own extension gate, which is
exactly the duplication TASK-3 removes — so TASK-3 CANNOT land before this task, or
`app/graphql/x.yml` starts being linted as GraphQL. It is already an `AppFile` whose
`fileType` is GraphQL while `sourceCodeTypeOf` hands it the YAML parser.

## The rule, read off the backend (2026-08-02)

`~/projects/desksnearme/app/models/*.rb`, `PHYSICAL_PATH` per model. The extension is
enforced by the model, not by the converter table, and it is NOT uniform:

| Type | backend `PHYSICAL_PATH` | extension enforced |
|---|---|---|
| Page (`page.rb:7`) | `(pages\|views/pages)/(.+)` | **no — any extension** |
| Layout / Partial (`instance_view.rb:9`) | `(views/partials\|views/layouts\|lib)/(.+)` | **no — any extension** |
| Asset (`asset.rb:8`) | `assets/` | no |
| GraphQL (`graph_query.rb:7`) | `…/(.+)\.graphql\z` | `.graphql` |
| Authorization, Email, ApiCall, Sms, Migration, FormConfiguration | `…/(.+)\.liquid\z` | `.liquid` |
| Table, UserProfileType, TransactableType, Translation | `…/(.+)\.yml\z` | **`.yml` only** |

Note `instance_view.rb:8` defines an `EXTENSION = '.liquid'` constant and then does not
use it in `PHYSICAL_PATH`. Mirror the regexp, not the constant.

**`.yaml` is not a platformOS extension.** Every YAML type anchors `\.yml\z`.
`REFERENCE_EXTENSIONS` currently lists `['.yml', '.yaml']` for four types, which puts
`.yaml` into `SOURCE_FILE_EXTENSIONS` and `SOURCE_FILE_GLOB`, so the walk collects
`app/translations/en.yaml` and the linter reports on a file the platform will not
deploy. Same class of over-inclusion TASK-1.1 fixed for `seed/post_import/`, and it
needs the same before/after file-count check on the real projects.

## Where it goes

- `REFERENCE_EXTENSIONS` already IS the per-type extension table this task needs — it
  is just not consulted during classification. Give it the two missing distinctions:
  which types enforce their extension (all but Page/Layout/Partial/Asset), and drop
  `.yaml`. Then `PATH_PATTERNS` (`path-utils.ts:528`) appends the enforced extension to
  its `appLevel` / `moduleLevel` regexps, and `TYPE_MATCHERS` gets the same treatment
  or dies with TASK-3.1.
- Permissive types stay permissive: `app/views/pages/home.html` must keep classifying
  as `Page`, because the backend deploys it. Whether the LINTER can parse it is
  `isSupportedSourceFile`'s question (TASK-3), not this one.

## marketplace_builder: decision reversed

The original task said "drop `marketplace_builder` support entirely (user-approved)".
That is dropped. The branch kept it in `APP_ROOTS`, `APP_SOURCE_SUBTREES`, `walk.ts`
and `AppFile`, and the backend agrees — `deployable.rb:21`:

    DIR_PREFIX = %r{^/?((marketplace_builder|app)/|modules/(.+)(private|public|marketplace_builder|app)/)?}

Mirroring the backend and removing `marketplace_builder` are contradictory goals.
Keeping it is also the cheap side of the asymmetry: dropping it makes a project on the
legacy root lint nothing at all, silently.

## Known deviations to keep (document, do not mirror)

- `DIR_PREFIX`'s group is OPTIONAL, so the backend regexps also match a root-level
  `translations/en.yml` with no app root at all. We require an app root. Anchoring is
  the whole point of `parseAppPath` and TASK-1.1.
- Backend `graph_query.rb:5` is `(graph_queries|graphql)s?/`, so `graphqls/` is a
  fourth spelling we do not have (`app/graphqls/x.graphql` → undefined today). Cheap to
  add to `FILE_TYPE_DIRS`; worth a `// backend quirk:` comment either way.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Classification enforces the extension for the types where the backend does (GraphQL `.graphql`; Authorization/Email/ApiCall/Sms/Migration/FormConfiguration `.liquid`; Table/UserProfileType/TransactableType/Translation `.yml`) and leaves Page/Layout/Partial/Asset permissive, each with a comment naming the backend model file:line
- [x] #2 `parseAppPath` and `getFileType` agree on every case in #1 — one derivation, not two tables
- [x] #3 `app/graphql/x.yml`, `app/translations/en.json` and `app/transactable_types/x.yml.bak` classify as undefined; `app/views/pages/home.html` still classifies as Page
- [x] #4 `.yaml` is removed from `REFERENCE_EXTENSIONS` / `SOURCE_FILE_EXTENSIONS`, and the file count and file set for pos-module-community and arabbank are compared before and after so nothing is silently dropped
- [x] #5 marketplace_builder stays; the reversal is recorded where `APP_ROOTS` is defined, with the `deployable.rb:21` reference
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02.

## What shipped

Classification now consults the extension, derived from one table rather than a second
one. `REFERENCE_EXTENSIONS` moved above the matchers so `TYPE_MATCHERS` (unanchored)
and `PATH_PATTERNS` (anchored) both build their regexps from it through
`extensionPattern(type)` — that is AC#2: there is no way for the two classifiers to
disagree, because neither owns the rule.

`EXTENSION_AGNOSTIC_TYPES` = Page, Layout, Partial, Asset, each with its backend
file:line. Everything else anchors: `.graphql`, `.liquid`, `.yml`.

`.yaml` is gone from `REFERENCE_EXTENSIONS`, so `SOURCE_FILE_EXTENSIONS` is now
`['.liquid', '.yml', '.graphql']` and `SOURCE_FILE_GLOB` is `**/*.{liquid,yml,graphql}`.
Five guard specs caught the change and were updated, not exempted: check-node's glob
patterns, two startServer watcher assertions, and the two VS Code documentSelector
tests. `NEEDS_APP_SUBTREE_ANCHOR` in vscode-extension dropped its dead 'yaml' entry.

marketplace_builder stays. `deployable.rb:21` keeps it in `DIR_PREFIX`, so mirroring
the backend and removing it were contradictory goals. Recorded at `APP_ROOTS`.

The `graphqls/` quirk from `graph_query.rb:5` is a documented deliberate deviation, not
an oversight: a fourth directory spelling costs four more candidate paths on every
unresolved `{% graphql %}`, and no real project uses it.

## Verified on all four real projects

App file sets are BYTE-IDENTICAL before and after — 0 removed, 0 added:

| | files | removed | added |
|---|---|---|---|
| pos-module-community | 946 | 0 | 0 |
| arabbank | 3139 | 0 | 0 |
| Accala-MP | 2789 | 0 | 0 |
| htevent | 2895 | 0 | 0 |

Offense totals identical per-check too: community 43 → 43, arabbank 9623 → 9623, with
every per-check count matching. So this closes the hole without collateral — the
projects simply have no misplaced-extension files.

Full monorepo: 294 test files, 2700 tests, build and type-check clean.
<!-- SECTION:NOTES:END -->
