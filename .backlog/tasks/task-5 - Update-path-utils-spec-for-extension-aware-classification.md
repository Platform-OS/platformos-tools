---
id: TASK-5
title: Update path-utils spec for extension-aware classification
status: Done
assignee: []
created_date: '2026-05-11 13:10'
updated_date: '2026-08-02 09:51'
labels:
  - platformos-common
  - testing
dependencies:
  - TASK-1
  - TASK-3
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend `packages/platformos-common/src/path-utils.spec.ts` (726 lines) to pin the
extension-aware semantics TASK-1 and TASK-3 introduce.

Rewritten 2026-08-02: the original "remove every `marketplace_builder` assertion"
instruction is **cancelled** — that root stays (see TASK-1). The
`describe('marketplace_builder/ legacy root')` block at `:131` and the
`parseAppPath` case at `:677` ("gives a marketplace_builder file no search-path
position") both stay exactly as they are.

## Add

**Wrong extension is not the type** (needs TASK-1):
- `app/translations/en.json` → `getFileType` and `parseAppPath` both `undefined`
- `app/graphql/x.txt`, `app/graphql/x.yml` → `undefined`
- `app/transactable_types/x.yml.bak` → `undefined`
- `app/authorization_policies/x.txt` → `undefined`
- `app/translations/en.yaml` → `undefined` (`.yaml` is not a platformOS extension —
  every YAML model anchors `\.yml\z`)

**Permissive types stay permissive** — the backend deploys these, so classification
must not reject them, and `isSupportedSourceFile` is what says the linter cannot read
them:
- `app/views/pages/home.html` → `Page`, `isSupportedSourceFile` `false`
- `app/views/layouts/1col.html.liquid` → `Layout`, supported `true`
- `app/assets/app.js` → `Asset`, supported `false`

**Asset partials in known dirs** (already true, currently unpinned):
- `app/views/partials/foo.css.liquid`, `foo.js.liquid`, `foo.scss.liquid` →
  `isSupportedSourceFile` `false` while still classifying as `Partial`

**From TASK-2**, only for the types that actually ship:
- `app/activity_streams/handlers/x.yml` → `ActivityStreamsHandler`, plus the
  `modules/<name>/{public,private}/` and `app/modules/…` forms
- `app/activity_streams/grouping_handlers/x.yml` → `ActivityStreamsGroupingHandler`
- the JSON manifests / lock file if TASK-2 AC#2 decides in their favour, including the
  negative `modules/core/public/pos-module.lock.json` → `undefined`

**Backend quirk** if TASK-1 adds it: `app/graphqls/x.graphql` → `GraphQL`, with the
`graph_query.rb:5` reference in a comment.

## Already covered — do not duplicate

`app/config.yml` / `app/user.yml` classification and their no-offense behaviour are
pinned by `platformos-check-common/src/fixed-path-files.spec.ts`. The name ⇄ path
round-trip is `platformos-common/src/name-path-roundtrip.spec.ts`. The subtree grammar
is `app-source-subtrees.spec.ts`. Add classification cases here, not copies of those.

Per the repo's test guidelines: assert whole values in a single equality (`toEqual`
over the full `AppPathInfo`, not a field at a time), and prefer a table-driven
`it.each` over one `it` per path — the existing describes already read that way.

**Files:**
- `packages/platformos-common/src/path-utils.spec.ts`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wrong-extension cases (including `.yaml`) assert `undefined` from BOTH `getFileType` and `parseAppPath`, so the two derivations cannot drift apart
- [x] #2 Permissive-type cases pin the split: classification succeeds, `isSupportedSourceFile` decides parseability
- [x] #3 Asset-partial and ActivityStreams cases added; marketplace_builder coverage left intact
- [x] #4 `yarn workspace @platformos/platformos-common test` passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02. path-utils.spec.ts went 97 → 149 tests; the package went 325 → 377.

## Added

- `describe('the extension is part of the type, where the backend says so')` — 12
  rejected paths as an `it.each`, each asserting BOTH `getFileType` and `parseAppPath`
  return undefined, plus a positive control that the same paths with the right
  extension still classify. Asserting both classifiers per case is AC#1 and is what
  would catch them drifting apart again.
- `describe('Page, Layout, Partial and Asset deploy under any extension')` — the
  permissive types, again through both classifiers.
- `describe('ActivityStreams handlers')` — all four roots plus `.json`/`.yaml` rejection.
- A new top-level `describe('isSupportedSourceFile')` — 12 readable paths, 12
  unreadable ones, and an explicit test for the split (a non-Liquid page classifies as
  Page and is not readable).

## Two specs were generating unclassifiable paths

`name-path-roundtrip.spec.ts` and `app-source-subtrees.spec.ts` each hand-maintained a
switch mapping type → extension, and both hardcoded `thing.liquid` as the default. With
classification extension-aware they started producing paths that cannot parse, and the
round-trip test failed for 20 of them.

Fixed at the root rather than by extending the switches: `getReferenceExtensions(type)`
is now exported and both specs derive the leaf from it. That is one fewer copy of the
extension knowledge — the same reason `directory-knowledge.spec.ts` exists.

## Not done, deliberately

The original instruction to strip every `marketplace_builder` assertion is cancelled
(TASK-1). That describe and the `parseAppPath` search-path-index case are untouched.
<!-- SECTION:NOTES:END -->
