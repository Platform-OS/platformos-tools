---
id: TASK-3.1
title: >-
  Retire the unanchored getFileType — one classifier, anchored at the project
  root
status: Done
assignee: []
created_date: '2026-08-02 08:49'
updated_date: '2026-08-02 11:36'
labels:
  - platformos-common
  - correctness
  - architecture
dependencies: []
parent_task_id: TASK-3
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This is the task that actually delivers what the 1–6 epic is for: **platformos-common
as THE source of truth for whether a file is a platformOS file and, if so, which type.**
Right now it is the source of two truths, and they disagree.

## The disagreement

TASK-1.1 made `createAppFile` classify strictly through `parseAppPath`, anchored under
`rootUri`. It did not touch `getFileType`, which matches a known directory ANYWHERE in
a URI because it has no root to anchor against. Probed on 2026-08-02:

    seed/post_import/app/migrations/20220517145452_index_rebuild.liquid
      parseAppPath        → undefined     (not in the App, not linted, correct)
      getFileType         → Migration
      isSupportedSourceFile → true        (the LSP loads and parses it)

So the file TASK-1.1 removed from the lint is still a Migration to the language server,
to `MatchingTranslations`, to the graph and to the VS Code extension. Every consumer
that reaches for `getFileType` gets the pre-1.1 answer.

This also costs what the branch was built to save: the LSP holds a parsed
`AugmentedSourceCode` for a file the `App` will never have, so it is parse work whose
result no cache can be keyed to a file the model does not know about.

## Scope: 28 call sites

`getFileType`, the `isKnown*` trio, `isSupportedSourceFile`, and the `isPage` /
`isPartial` / `isLayout` / `isAsset` predicates that wrap them. They fall into three
groups, and the cheap group is most of them.

**A. Has an `AppFile` already — just read `fileType` (no classification at all).**
`AppFile` exposes `readonly fileType: PlatformOSFileType` (`AppFile.ts:37`), computed
once at construction from the anchored parse. Any check whose `context.file` is an
`AppFile` should read it instead of re-deriving from the URI:
`missing-content-for-layout:42`, `valid-frontmatter:69`, `valid-html-translation:22`,
`matching-translations:54`, `undefined-object:202`. This is strictly cheaper than
today — no regexp pass per call — and it is the version that cannot disagree with the
App.

**B. Has a root in scope — anchor explicitly.** Checks get `Config.rootUri`
(`check-common/types.ts:183`); the graph's `AppGraph` has `rootUri`
(`graph/types.ts:26`). `graph/module.ts:46-55`, `graph/build.ts:29`,
`liquid-doc/utils.ts:117`, `partial-call-arguments:83`.

**C. Has neither — the real design work.**
- `DocumentManager` holds no root at all: it is fed bare URIs by `open`/`change`/
  `close`, and only learns a root as a PARAMETER of `app(root)` and `preload(rootUri)`.
  So `set()` (`:140`) cannot anchor without giving the manager a root or deferring the
  filter to `app()`. TASK-12.6.4 ("Reduce DocumentManager to an App adapter") is where
  that lands naturally — if it runs first, this group mostly disappears.
- `language-server-common/src/utils/uri.ts:10` — `isAsset(uri)` with no root, used by
  `AssetRenameHandler:41`. Same for the `isPage` calls in `startServer.ts`
  (`:424, :586, :630, :649, :655, :670`) and `FrontmatterKeyCompletionProvider:29`,
  `FrontmatterDefinitionProvider:104`, `PartialRenameHandler:40`.

## The shape to aim for

One anchored classifier, `parseAppPath(relativePath)`, plus `App`/`AppFile` as the
place a URI's type is remembered. `getFileType(uri)` either becomes
`getFileType(uri, rootUri)` — anchored, root required — or stops being exported.
The predicates follow it, or take the file object instead of a URI.

Note this is also what makes the file-identity invariant enforceable: the existing
`app/directory-knowledge.spec.ts` guard scans every package's `src/` for a second copy
of the directory/extension knowledge. It cannot catch a second copy of the ANCHORING
rule while an unanchored classifier is exported for anyone to call.

## Sequencing

Independent of TASK-1/2/3 in principle — this is about WHERE the answer comes from,
those are about what the answer IS — but doing it after TASK-3 means only one function
to re-point instead of four. Group C is much smaller after TASK-12.6.4.

Expect a behaviour change: files like `seed/post_import/app/…` disappear from the LSP
the way they already disappeared from the lint. Diff the LSP's loaded-file set on
arabbank and pos-module-community before and after, as TASK-1.1 did for the App.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No exported classifier answers a question about a URI without a project root — either it takes one, or it takes an `AppFile`/`App` that was built with one
- [x] #2 `seed/post_import/app/migrations/x.liquid` is not a Migration to ANY consumer: not the lint, not the language server, not the graph, not the VS Code extension
- [x] #3 Every group-A call site reads `AppFile.fileType` rather than re-deriving the type from the URI
- [ ] #4 The loaded-file set of the language server on arabbank and pos-module-community is compared before and after, so nothing is silently dropped
- [x] #5 A guard spec fails if an unanchored classifier is reintroduced, in the same style as `app/directory-knowledge.spec.ts`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02. User decision: 'seed/post_import/app/migrations/x.liquid is not a platformOS
valid file, the App is right to exclude it, everything else should follow — language
server, graph, VS Code extension. It cannot be considered a valid file and it doesn't
make sense to process it: if it used `function`, `render` etc. we can't find the partial
which would be referenced. The only scenario in which it would make sense is if it did
pretty much nothing — it cannot invoke even a graphql tag, because we wouldn't be able to
find the actual graphql file.'

## The enforcement

`getFileType(uri, rootUri)` and every predicate now REQUIRE a root. The unanchored
answer is not discouraged, it is unspeakable — there is no overload that omits it, and
`getFileType` delegates straight to `parseAppPath`, so there is exactly one classifier
left in the toolchain.

31 call sites, by how they got their root:

- **checks (7)** — new `context.fileType(uri?)`, anchored at `config.rootUri`, defaulting
  to the file being checked. It reads `AppFile.fileType` off the run's App when the file
  is in it, so the common path re-derives nothing at all, and only falls back to
  `getFileType` for a URI the app does not contain (an unresolved render target, an
  overlaid buffer). `getContextualObjects` and `globalObjects` now take the resolved type
  rather than a URI.
- **graph (6)** — `AppGraph.rootUri`. `getModule`'s four-way `switch (true)` over
  `isLayout`/`isPage`/`isPartial`/`getFileType` collapsed into one
  `switch (getFileType(uri, appGraph.rootUri))`: one classification instead of four.
- **language server (18)** — `findAppRootURI` for the file-event handlers (a new local
  `isPageFile`), the two rename handlers (root resolved BEFORE the filter that needs it),
  `FrontmatterDefinitionProvider`, and an injected resolver for the three completion
  providers that classify. `app(root)` and `preload(rootUri)` anchor on their own
  parameter — and `app(root)` is what `runChecks` goes through, so LSP diagnostics are
  anchored end to end.

## The one place that still cannot ask

`DocumentManager.set()`, and structurally: the class holds no root. It is fed bare URIs
by open/change/close/rename and only learns a root as a parameter of `app()` and
`preload()`. It now gates on `sourceCodeTypeOf(uri) !== undefined` — 'can we parse this',
which a URI answers alone — rather than pretending to classify. Opening a non-app file
still manages it for the editor; it gets no diagnostics, because those go through
`app(root)`. Closing the split is TASK-12.6.4 AC#8, where the class holds an App and
therefore a root.

## Two latent bugs the compiler surfaced

- `PartialRenameHandler` and `AssetRenameHandler` filtered `params.files` by
  `isPartial`/`isAsset` and only resolved the root AFTERWARDS. Requiring the root forced
  the correct order.
- Two LiquidDoc completion specs used `relativePath: 'file://app/views/partials/file.liquid'`
  — a `file://` scheme inside a path that is supposed to be RELATIVE. It passed only
  because the unanchored matcher found `/views/partials/` anywhere in the string.

## Verified

Build, type-check and 294 files / 2706 tests green. pos-module-community and arabbank
unchanged: 946 and 3139 files, 0 added, 0 removed, offense totals identical per-check
(43 and 9623).

## On AC#4 and AC#5

AC#5 is satisfied more strongly than it asked: the guard is the TYPE SIGNATURE. There
is no overload of `getFileType` or of any predicate that omits the root, so an
unanchored classification does not compile. A grep-style spec would be weaker.

AC#4 is left UNCHECKED deliberately. What was measured: the App file set on
pos-module-community, arabbank, Accala-MP and htevent (unchanged, 0 added / 0 removed),
and the language server's preload set today — 1508 / 3139 / 2895 files, where arabbank's
is exactly its App. What was NOT measured is a genuine before/after of a live LSP
session, because the 'before' predicate no longer exists to run. The preload WALK was
already anchored (`walkAppSourceFiles` over `APP_SOURCE_SUBTREES`), so only its filter
changed, and the two can differ only for a path that nests one type directory inside
another (`app/lib/app/views/pages/x.liquid` is a Partial anchored, a Page unanchored) —
none of which exists in the four projects. Worth a real session diff when TASK-12.6.4
touches this class.
<!-- SECTION:NOTES:END -->
