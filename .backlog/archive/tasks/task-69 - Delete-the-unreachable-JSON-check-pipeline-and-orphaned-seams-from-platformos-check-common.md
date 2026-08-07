---
id: TASK-69
title: >-
  Delete the unreachable JSON check pipeline and orphaned seams from
  platformos-check-common
status: Done
assignee: []
created_date: '2026-08-07 10:48'
updated_date: '2026-08-07 12:44'
labels:
  - cleanup
  - check-common
  - dead-code
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A dead-code audit of `platformos-common` and `platformos-check-common` found a whole check pipeline that no input can reach, plus several dependency seams whose only consumers were already deleted. They cost review attention on every change to the check engine, keep a `Context` capability and a `Dependencies` field in the public API that nothing implements against, and half-justify a `lodash` runtime dependency.

## Why `SourceCodeType.JSON` is unreachable

`SOURCE_CODE_TYPE_BY_KEY` (`platformos-common/src/app/types.ts`) deliberately has no `.json` row — a platformOS app has no JSON source type, JSON responses come from `.json.liquid`, and Ruby's `App::REGEXP_MAP` agrees. `AppFile.type` is set from `sourceCodeTypeOf(uri)` (`AppFile.ts:99`) and `App.sourceCodes()` (`App.ts:115`) only yields files that have one. So no file reaching `check()` can carry `SourceCodeType.JSON`. Confirmed downstream: of the 41 shipped checks, 36 declare `LiquidHtml`, 4 `YAML`, 1 `GraphQL`, and none declare `JSON`.

## Two things must survive — this is the trap

- `jsonc/types.ts` (`JSONNode` and friends) is LIVE: the YAML AST reuses it (`yaml/parse.ts`), and `AST[SourceCodeType.YAML]` is `JSONNode`.
- `toJSONAST` / `toJSONNode` is LIVE via `toSourceCode`'s deliberate editor fallback (`to-source-code.ts:102`), which the language server's `DocumentManager` relies on to hold `.json` buffers the JSON language service answers hover/completion for. That fallback is documented as an EDITOR behaviour, not a classification.
- `visitJSON` (`visitors/json.ts`) is LIVE: `checkYAMLFile` calls it.

The JSON *parser* stays. The JSON *check pipeline* goes.

## The orphaned seams

- `src/create-safe-check.ts` — 13-line Proxy check wrapper, zero references, not exported from `index.ts`.
- `src/utils/file-utils.ts` — 4 of 5 exports unreferenced (~45 of 57 lines). `getFileSize` issues a `fetch()` HEAD request, a Shopify `RemoteAsset` leftover and the only network call in the linter. `doesFileExist` IS live (used by `checks/valid-frontmatter` and `checks/missing-asset`) and must stay.
- The `fileSize` seam falls with it: `Dependencies.fileSize` (`types.ts:450`), `makeFileSize` (`context-utils.ts`), and its wiring in `check()`. Its only consumer was the dead `doesFileExceedThreshold`.
- `getDefaultLocale` (`context-utils.ts`) takes `_fs` and `_rootUri`, ignores both, and returns the `DEFAULT_LOCALE` constant. It is wrapped in `cached()`, declared as `Dependencies.getDefaultLocale`, and wired into every run. No check calls `context.getDefaultLocale`; the checks that need a locale import `DEFAULT_LOCALE` directly.
- Shopify-era types in `types.ts` with no producer: `PlatformOSFile`, `PartialSourceCode`, `PageLiquidSourceCode`.

## Scope boundary

Deletion only. Do NOT fold in the refactors the same audit identified (unifying the three tree walkers, consolidating the four memoization mechanisms, tightening `DocumentsLocator`) — those are separate work, and one of them depends on this task having removed `createCorrector`'s JSON arm first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `check()` no longer contains a `SourceCodeType.JSON` branch, and `checkJSONFile` is gone
- [x] #2 `JSONValidator.ts`, `makeLazyValidateJSON`, `Context.validateJSON` and the `ValidateJSON` type are removed; `Dependencies.jsonValidationSet` is preserved, because the language server's `JSONLanguageService` still consumes it
- [x] #3 `JSONCorrector` and its `createCorrector` arm are removed; `createCorrector` still handles LiquidHtml, GraphQL and the YAML throw, and its exhaustiveness check still compiles
- [x] #4 `jsonc/types.ts`, `toJSONAST`/`toJSONNode` and `visitJSON` are retained and still work — a test proves the LSP's `.json` buffer fallback in `toSourceCode` still parses, and the YAML checks still run
- [x] #5 `src/create-safe-check.ts` is deleted
- [x] #6 The four unreferenced exports of `src/utils/file-utils.ts` are deleted and `doesFileExist` still works for `valid-frontmatter` and `missing-asset`
- [x] #7 The `fileSize` seam is removed end to end: `Dependencies.fileSize`, `makeFileSize`, and its wiring in `check()`
- [x] #8 `getDefaultLocale` is removed from `Dependencies`, `context-utils.ts` and the `check()` wiring; checks needing a locale continue to use the `DEFAULT_LOCALE` constant
- [x] #9 `PlatformOSFile`, `PartialSourceCode` and `PageLiquidSourceCode` are deleted from `types.ts`
- [x] #10 `lodash` usage is re-checked after `json-corrector` is deleted: either the dependency is narrowed to what `checks/variable-name` needs or the package.json entry is justified in the final summary
- [x] #11 `NPM_TOKEN=dummy yarn build` and `NPM_TOKEN=dummy yarn test` both pass across the monorepo, including the language server and MCP supervisor suites
- [x] #12 A lint run over a real project in ~/projects/pos produces the same offenses before and after, demonstrating the deletions changed no behaviour
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification method

**The obvious equivalence check was invalid and had to be replaced.** A raw text diff of
CLI output showed ~93k changed lines on arabbank and ~205k on htevent, which read as a
catastrophic behaviour change. The control — running the SAME binary twice — differed by
111,830 lines, so the CLI's offense ORDER is nondeterministic and a text diff cannot
answer the question at all. Two of the four projects "matched" only because they are
small enough that the jitter did not surface.

Replaced with an offense-SET oracle (`scratchpad/normalize.py`): decode the CLI's JSON
chunks with `raw_decode`, canonicalize recursively (sort lists, sort dict keys), compare.
Validated on the control first — two runs of one binary come out EQUIVALENT — and only
then used for before/after.

## Sabotage results (all three deliberate breaks were caught)

- Fallback returns an unparsed `Error` → caught (1 LSP test before the new spec, 1 new
  spec case after).
- `toSourceCode` types EVERY extension as JSON → caught by the new spec's control case.
- YAML visiting removed from `checkYAMLFile` → 9 failures across MatchingTranslations /
  ValidHTMLTranslation.

Before the new spec existed, the ONLY thing guarding the editor-buffer JSON fallback was
one incidental assertion inside `TranslationStringDefinitionProvider.spec.ts`, and
nothing at all asserted the fallback actually PARSES rather than merely assigning the
right `type`. That gap is now closed by `src/to-source-code.spec.ts`, which pins both
halves plus a control.

## Scope additions found during execution (not in the original plan)

1. `isValid` — a free function exported from `JSONValidator.ts` and commented "We'll
   reuse this in the language server" — is genuinely live LSP code. It never needed the
   class (it takes the `LanguageService` its caller owns), so it MOVED to
   `JSONLanguageService.ts` beside its only consumer rather than being deleted. Caught by
   the build, not by any test.
2. `check-node/src/config/load-config-description.ts` concatenated `allChecks` with
   third-party checks typed `CheckDefinition<SourceCodeType>`. Narrowing `allChecks`
   broke it. The widening now happens at the join, which is where it belongs — a plugin
   is unconstrained, the shipped set is not. This surfaced only in the three MCP
   supervisor integration specs that rebuild the package from source; the ordinary
   `yarn build` passed.
3. `Corrector<SourceCodeType.JSON>` as `never` was too clever — `never` intersects every
   `Fixer<T>` call down to an uncallable signature (5 type errors). Reverted to a
   `StringCorrector` placeholder, matching how YAML is already handled, with the reason
   written down.

## Deliberately NOT done

- `lodash` stays: `checks/variable-name` still needs `camelCase`/`kebabCase`/`snakeCase`.
  Only `vscode-json-languageservice` was dropped from check-common (it was there solely
  for the deleted `JSONValidator`).
- The three refactors from the same audit (unify the three tree walkers, consolidate the
  four memoization mechanisms, tighten `DocumentsLocator`) remain untouched per the
  task's scope boundary.

## Follow-up done in the same change: the unused dep in platformos-common

Removed `vscode-json-languageservice` from `platformos-common/package.json`. It had never
been imported anywhere in that package's `src/` — the sole occurrence was the expected
list inside `package-boundaries.spec.ts` itself. Confirmed the other three (`graphql`,
`js-yaml`, `vscode-uri`) ARE imported, `graphql` including a `graphql/language` subpath.

**Why the existing guard could not catch it, and what now does.** The boundaries spec
pinned which dependencies are DECLARED, so an unused entry was consistent with itself:
the manifest and the expected list agreed, review re-approved both every time the list
changed, and nothing ever asked whether `src/` imported the thing. Added a second `it`
that asserts every declared dependency is actually imported (subpath-aware).

Sabotage, two variants:
- Re-add the dep to the manifest only -> BOTH tests fail.
- Re-add it AND update the pinned list to match (the historical failure mode) -> the
  original exact-list test PASSES and only the new test fails. That is the case the new
  guard exists for; without it the removal would silently regress.

Lockfile is unchanged: `vscode-json-languageservice@^5.7.1` is still required by
`platformos-language-server-common`, so `yarn install` is a no-op on `yarn.lock`
(verified). Full suite after: 359 files / 3852 tests, 0 failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted the unreachable JSON check pipeline and four orphaned dependency seams from
`platformos-check-common`. **Net −303 lines** (595 deleted, 292 added, and the additions
are mostly the new spec plus doc corrections).

## Removed

- **The JSON check pipeline**: `check()`'s `SourceCodeType.JSON` branch, `checkJSONFile`,
  `JSONValidator.ts`, `makeLazyValidateJSON`, `Context.validateJSON`, `ValidateJSON`,
  `JSONCorrector` (+ its `createCorrector` arm and spec), `JSONCheck`,
  `JSONCheckDefinition`, `JSONFixer`, `JSONSuggestion`. No file can reach it: the
  toolchain has no `.json` row in `SOURCE_CODE_TYPE_BY_KEY`, so `AppFile.type` is never
  JSON, and none of the 41 shipped checks declares the type.
- **`create-safe-check.ts`** — whole file, zero references.
- **Four of five exports of `utils/file-utils.ts`**, including a `fetch()` HEAD request
  left over from Shopify's `RemoteAsset` check — the only network call in the linter.
- **The `fileSize` seam** end to end (`Dependencies.fileSize`, `makeFileSize`, wiring).
- **`getDefaultLocale`** — took an `fs` and a root, ignored both, returned a constant,
  and was memoized into a promise on every run. No check ever called it.
- **Shopify-era types**: `PlatformOSFile`, `PartialSourceCode`, `PageLiquidSourceCode`.
- **`vscode-json-languageservice`** from check-common's dependencies.

## Kept, with the reason now written down

`jsonc/types.ts` (the YAML AST is a `JSONNode` tree), `toJSONAST`/`toJSONNode` and
`toSourceCode`'s JSON fallback (the language server's `DocumentManager` holds `.json`
editor buffers), and `visitJSON` (YAML's visitor). `SourceCodeType.JSON` stays in the
enum for that editor role; `check()`'s arm is now an explicit empty case that keeps the
switch exhaustive.

## Improvement that fell out

`checkYAMLFile` lost its `as any`: `visitJSON` is now typed for `YAMLCheck`, its only
caller.

## Verification

- `yarn build` green; `yarn test` **359 files / 3851 tests, 0 failures** (baseline was
  359/3854 — the delta is exactly the deleted `json-corrector.spec.ts` and the two
  `getDefaultLocale` cases, minus the 3 new ones).
- **Behavioural equivalence on four real projects** (arabbank, Accala-MP,
  pos-module-community, htevent): identical offense sets — 28,554 offenses over 10,329
  files — via an order-insensitive oracle validated against a same-binary control. See
  Notes: the naive text diff was invalid because CLI output order is nondeterministic.
- Three deliberate sabotages all caught; the new `to-source-code.spec.ts` pins the
  editor-buffer fallback (which was effectively untested) with a control against the
  "swallow every extension" failure mode.
- `packages/platformos-check-common/CLAUDE.md` corrected in the same change — it
  documented `fileSize`, `getDefaultLocale`, `validateJSON` and `JSONCorrector` as live.

Branch `cleanup/task-69-dead-json-pipeline`. Not committed.

## Addendum — unused dependency in platformos-common

Also removed `vscode-json-languageservice` from `platformos-common/package.json`, which
was declared and never imported. The package's `package-boundaries.spec.ts` pinned the
dependency LIST but never checked the entries were used, so the unused one was
self-consistent and survived every review of that list. Added a second guard asserting
every declared dependency is actually imported (subpath-aware, so `graphql/language`
counts as using `graphql`).

Proven load-bearing by the sharper sabotage: re-adding the dependency *and* updating the
pinned list to match leaves the original test green and fails only the new one.

`yarn.lock` unchanged — the language server still requires the package. Final suite:
359 files / 3852 tests, 0 failures; build green.
<!-- SECTION:FINAL_SUMMARY:END -->
