---
id: TASK-95
title: >-
  platformos-graph: resolve translation keys to the files that define them, so a
  translation file has dependants
status: To Do
assignee: []
created_date: '2026-08-25 15:31'
labels:
  - platformos-graph
  - translations
  - impact
  - structural
dependencies: []
references:
  - packages/platformos-graph/src/graph/traverse.ts
  - packages/platformos-graph/src/types.ts
  - packages/platformos-check-common/src/translation-usage.ts
  - packages/platformos-check-common/src/checks/translation-utils.ts
  - packages/platformos-check-common/src/checks/translation-key-exists/index.ts
  - packages/platformos-mcp-supervisor/src/impact/dependants.ts
priority: medium
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A translation file has no dependants as far as the graph is concerned, so nothing can answer "what breaks if I remove this key". Editing `app/translations/en/app.yml` is invisible to every consumer of the graph.

WHAT ALREADY EXISTS — more than it first appears, which is why this is a gap to close rather than a feature to invent:

  - `isTranslationKeyUsage` (check-common `translation-usage.ts`) is already the SINGLE
    source of truth for "what counts as a key usage", and its docblock already says it is
    shared by `TranslationKeyExists` and the graph's extraction. Nothing new is needed to
    recognise a usage.
  - The graph ALREADY extracts them: `traverse.ts` collects `translationKeys` and publishes
    `ModuleStructural.translation_keys` — sorted, de-duplicated, per file.
  - `loadAllDefinedKeys` (check-common `translation-utils.ts`) already enumerates every
    DEFINED key across app search paths and modules, prefixing module keys with
    `modules/<name>/`.

WHAT IS MISSING is the join between the two: nothing resolves a key to the FILE that defines
it, so `extractFileReferences` emits no edge for a translation usage. `translation_keys` is a
structural FACT on a module (a list of strings) and is populated only by a full
`buildAppGraph`; edges are a different thing, and only edges answer "who depends on this
file".

WHY IT MATTERS BEYOND ONE CONSUMER. Three things want this answer and none can have it:
  - `validate_code`'s impact (TASK-94) cannot report a page broken by a removed key.
  - The language server cannot offer find-references or rename on a translation key.
  - Nothing can report an unused translation key, the mirror of the same query.

Doing it in the graph is what keeps that one answer shared. It was nearly done in the MCP
supervisor instead — diffing the YAML for removed keys and grepping for them — which would
have given one consumer private knowledge of platformOS wiring that the others could not
reach, in a package whose README says it detects nothing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A translation-key usage resolves to the file(s) that DEFINE the key, and `extractFileReferences` emits an edge for it — so `dependantsOf(translationFile)` in the MCP supervisor returns the pages that use its keys with no supervisor-side change
- [ ] #2 Recognition reuses `isTranslationKeyUsage` and definition-side enumeration reuses `loadAllDefinedKeys` (or a shared extraction beneath it). Neither is re-spelled in the graph — the existing docblock's claim that there is ONE definition of a key usage stays true
- [ ] #3 The MANY-TO-ONE question is decided explicitly and documented: one key can be defined in several files (per locale, and app vs `modules/<name>/`). Whether an edge is emitted per defining file, for the default locale only (matching what `TranslationKeyExists` loads), or for all locales, is a deliberate choice with its reasoning recorded — not whatever the first implementation happens to do
- [ ] #4 The COST of resolution is measured on the 2,768-file corpus and recorded. `extractFileReferences` is called per candidate file on the supervisor's request path, so a resolution that re-reads or re-parses translation files per call is a per-request regression, not a one-off graph-build cost
- [ ] #5 The SUBSTRING PREFILTER problem is solved or explicitly declared out of scope, with the consequence stated. `dependantsOf` narrows candidates with `source.includes(name)` where `name` is the target's logical name — but a page contains `'app.greeting'`, never the string `en/app.yml`, so the prefilter matches nothing and a translation target either finds no dependants or forces a full-project parse. Whichever way it goes, the outcome must be measured rather than assumed
- [ ] #6 A module's keys keep their `modules/<name>/` prefix through resolution, so a module translation and an app translation of the same name do not collide
- [ ] #7 Nothing regresses for the existing edge kinds: `buildAppGraph` output is unchanged for a project with no translations, and the supervisor's `dependants.spec.ts` still passes untouched
- [ ] #8 A test asserts the negative: a key used but defined NOWHERE produces no edge and no crash — that case is `TranslationKeyExists`'s to report, not the graph's to guess at
<!-- AC:END -->
