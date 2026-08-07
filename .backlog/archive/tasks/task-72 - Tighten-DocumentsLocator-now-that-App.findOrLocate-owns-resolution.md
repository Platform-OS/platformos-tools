---
id: TASK-72
title: Tighten DocumentsLocator now that App.findOrLocate owns resolution
status: Done
assignee: []
created_date: '2026-08-07 11:56'
updated_date: '2026-08-07 12:41'
labels:
  - cleanup
  - platformos-common
  - refactor
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`DocumentsLocator` (`platformos-common/src/documents-locator/DocumentsLocator.ts`, 437 lines) kept its old shape after `App.findOrLocate` took over the actual resolution rule. What is left around that delegation has accumulated redundancy.

## What is there now

- **One relation spelled four times.** The exported `DocumentType` union (8 members), the `FILE_TYPE_BY_DOCUMENT_TYPE` map (4 entries), and the anonymous union `'partial' | 'graphql' | 'asset' | 'layout'` written inline in three separate private signatures (`getSearchPaths`, `locateFile`, and a 3-member variant in `listFiles`). The inline unions are the same set as the map's keys and have no name.
- **`locateFile` is a one-line delegate** to `this.appFor(rootUri).findOrLocate(...)` that exists only to map a document type to a file type — which `FILE_TYPE_BY_DOCUMENT_TYPE` already does at the one call site that matters.
- **`getSearchPaths` re-maps through `FILE_TYPE_BY_DOCUMENT_TYPE`** a second time, for the two callers (`listFiles`, `expandDynamicPath`) that still need directory paths rather than a resolved file.
- **Unreachable `default:` arms.** `locate` handles all 8 union members and still has `default: return undefined`. `locateDefault` handles all 8 and has both `case 'theme_render_rc': return undefined` and `default: return undefined` — two spellings of the same dead branch.

## Why this needs care rather than enthusiasm

The `default:` arms are only unreachable **for callers that respect the types**. `list(rootUri, nodeName: string | undefined, filePrefix)` takes a bare `string`, so it is genuinely reachable with an unknown name and its `default: return []` must stay. Check each switch's parameter type before deleting its default; do not assume the four switches are alike.

`assertNever` (exported from check-common's `utils/types.ts`) is the tool for the ones that ARE exhaustive — it turns a future added `DocumentType` into a compile error instead of a silent `undefined`.

## Scope

Naming, redundancy and exhaustiveness only. Do not change resolution behaviour, the theme-search-path expansion, or the `locateDefault` creation-path answers — `nameToPaths`/`nameToCreationPath` ordering is load-bearing and covered by `name-path-roundtrip.spec.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The `'partial' | 'graphql' | 'asset' | 'layout'` set has ONE name, derived from `FILE_TYPE_BY_DOCUMENT_TYPE` rather than restated, and no private signature spells the union inline
- [x] #2 Each switch's `default:` arm is decided by checking what actually reaches it, not by assumption. **Amended during execution:** the criterion originally prescribed `assertNever` for the switches that look exhaustive over `DocumentType`. That was wrong — `DocumentLinksProvider` casts every visited tag name to `DocumentType`, so unknown names do arrive and `assertNever` would throw inside an LSP request. Satisfied instead by moving exhaustiveness into `Record<DocumentType, …>` tables (which fail to compile on a new member) and keeping a real runtime membership check
- [x] #3 `locateDefault`'s duplicated `theme_render_rc` / `default` pair is resolved to a single explicit branch that says why a search-path reference has no canonical location
- [x] #4 Resolution behaviour is unchanged: `locate`, `locateOrDefault`, `locateWithSearchPaths`, `list` and `locateDefault` return what they returned before for every document type, assets and the `modules/{name}/` prefix included
- [x] #5 A test proves a newly added `DocumentType` member is caught at compile time rather than silently resolving to `undefined`
- [x] #6 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` pass across the monorepo, graph and language-server suites included
- [x] #7 Lint output over the four sample projects in ~/projects/pos is offense-for-offense identical, via the order-insensitive oracle — MissingPartial/MissingAsset/MissingContentForLayout all resolve through this class, so a regression here shows up as offense churn
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The audit's "unreachable default arms" claim was WRONG, and checking it was the point

The originating report called `locate`'s and `locateDefault`'s `default:` arms
unreachable because both switches covered all 8 `DocumentType` members. They are
reachable, and deleting them would have been a real regression.

`DocumentLinksProvider.ts:63` does `const name = node.name as DocumentType` inside a
visitor that fires for **every** `LiquidTag` — `{% if %}`, `{% for %}`, a third-party
tag, anything. The only filter before the call is structural (`'partial' in markup`),
not a name check. So an unrecognized tag reaches `locate` whenever its markup happens to
carry a `partial` or `graphql` field, and the `default` is what makes that a document
link that does not resolve rather than a crash.

This also rules out `assertNever`, which the task itself had proposed: it would convert
graceful degradation into a thrown error inside an LSP request handler.

**Resolution — get both properties instead of trading one for the other.** A `switch`
can be exhaustive OR have a runtime fallback, never both: adding a union member does not
break a switch that has a `default`. So exhaustiveness moved OUT of the control flow and
into two `Record<DocumentType, …>` tables (`FILE_TYPE_BY_DOCUMENT_TYPE`,
`CREATION_TARGET_BY_DOCUMENT_TYPE`), which do fail to compile, and the runtime fallback
became an explicit `isDocumentType()` membership check with the cast documented as its
reason.

## Sabotage

Adding `'brand_new_tag'` to `DocumentType` without table entries produces **two compile
errors, one per table** (TS2741), and fails the runtime coverage spec's union check. The
old switch-with-default arrangement produced neither.

## Second-copy check on the new test

`document-type-coverage.spec.ts` hand-lists the eight types rather than deriving them
from the source, because a list generated from the table it verifies would agree with
itself by construction. A separate test reads the `DocumentType` union out of the source
and asserts the hand-list matches, so the two cannot drift.

## Behaviour preserved in one place worth naming

`listFiles`' extension filter was a `switch` spelling `.liquid` / `.graphql` / accept-all.
It now reads `getReferenceExtensions(fileType)` — Partial `['.liquid']`, GraphQL
`['.graphql']`, Asset `[]` — and an empty list means "no filter", which is exactly the
old `case 'asset': return true`. The same condition drives the extension-stripping below
it, which previously tested `type !== 'asset'` separately.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced `DocumentsLocator`'s duplicated type knowledge with two exhaustive tables and a
real runtime guard.

- **One relation, one place.** `FILE_TYPE_BY_DOCUMENT_TYPE` is now
  `Record<DocumentType, PlatformOSFileType>` covering all 8 members, replacing a 4-entry
  map plus the anonymous union `'partial' | 'graphql' | 'asset' | 'layout'` that was
  spelled inline in three private signatures. `getSearchPaths`, `locateFile` and
  `listFiles` all take a `DocumentType`.
- **`locate` and `list`** are a table lookup plus an `isDocumentType()` check instead of
  switches.
- **`locateDefault`**'s switch — including its duplicated `case 'theme_render_rc': return
  undefined` followed by `default: return undefined` — became a
  `CREATION_TARGET_BY_DOCUMENT_TYPE` lookup, with `theme_render_rc` as an explicit `null`
  meaning "no single canonical location".
- **`listFiles`' extension filter** comes from `getReferenceExtensions` rather than a
  hand-written switch, and drives the extension-stripping below it too.

**The task's own premise turned out to be wrong and the fix is better for it** — the
`default:` arms are reachable via an unchecked cast in `DocumentLinksProvider`, so
`assertNever` would have been actively harmful. See Notes.

Added `document-type-coverage.spec.ts`: a creation path asserted for all 8 types, an
unknown-tag case proving no throw, a control proving a known tag still resolves, and a
union-vs-hand-list check so the test's own list cannot drift.

## Verification

- `yarn build` green; `yarn test` **361 files / 3859 tests, 0 failures**.
- Lint equivalence on all four sample projects via the order-insensitive oracle:
  11060 / 252 / 481 / 16761 offenses, all SAME. `MissingPartial`, `MissingAsset` and
  `MissingContentForLayout` all resolve through this class, so this is a direct check.
- Sabotage: a new `DocumentType` member yields two compile errors plus a failing spec.
<!-- SECTION:FINAL_SUMMARY:END -->
