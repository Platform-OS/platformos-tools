---
id: TASK-3.2
title: >-
  Replace the asset-partial ignore-list with a parser whitelist keyed on the
  response format
status: Done
assignee: []
created_date: '2026-08-02 10:31'
updated_date: '2026-08-02 10:31'
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
Raised by the user right after TASK-3 landed: *"if we implemented the logic correctly,
then we would have the whitelist of files that are supported, we shouldn't need to
explicitly ignore certain files."*

Correct, and the toolchain had exactly one place violating it — the first line of
`isSupportedSourceFile`:

    if (/\.(s?css|js)\.liquid$/.test(uri)) return false;

## The bug the principle predicts, confirmed

An ignore-list is only consulted by the callers of the predicate holding it, and only
the language server consults this one. The lint reaches its files through
`App.fromPaths` (→ `parseAppPath`) and picks parsers through `sourceCodeTypeOf`,
neither of which knew about the regexp. Probed 2026-08-02:

    app/views/partials/theme.css.liquid   classified Partial   sourceCodeType LiquidHtml
                                          in App: yes          isSupportedSourceFile: NO
    app/assets/theme.css.liquid           classified Asset     sourceCodeType LiquidHtml

Linting a four-file fixture containing a `.css.liquid` partial, a `.css.liquid` asset
and a `.js.liquid` page produced **2 × LiquidHTMLSyntaxError** — the CLI parsing CSS
and JavaScript as Liquid+HTML, on files the editor refuses to open. An Asset was being
handed the Liquid parser too.

## The fix

`sourceCodeTypeOf` is already the toolchain-wide answer to "which parser" — used by
check-common's `toSourceCode`, the graph's `build`/`toSourceCode`, and the supervisor —
so making it right fixes every consumer at once. It was keyed on the LAST extension,
which is why `theme.css.liquid` looked like any other `.liquid` file.

It is now keyed on `sourceKeyOf`: the extension, except for `.liquid`, where the
RESPONSE FORMAT goes in front of it, because for a Liquid file the format IS the body
language. `SOURCE_CODE_TYPE_BY_KEY` lists the ten formats whose body the Liquid+HTML
parser models plus `graphql` and `yml`. `css.liquid` and `js.liquid` have no row —
absent, not excluded — and absence cannot be forgotten by a consumer.

The `.liquid` suffix inside each key is what stops `json.liquid` (a Liquid template
producing JSON, parsed) colliding with a plain `.json` file (not a platformOS source).
Which dotted segments count as formats comes from the platform's own FORMAT_ENUM
(`custom_view.rb:9`, twelve entries) via `formatFromFilePath`, so `modal.frame.liquid`
is a partial named `modal.frame` rather than a `frame`-format file.

`isSupportedSourceFile` then collapses to the intersection of the two whitelists:

    getFileType(uri) !== undefined && sourceCodeTypeOf(uri) !== undefined

"the platform deploys it" AND "we have a parser for it". No third clause, and the
`LIQUID_FILE_TYPES` `.liquid` gate is gone too — `app/views/pages/home.html` now falls
out of the parser whitelist rather than being special-cased.

Also dropped the dead `yaml` row from the parser table, following TASK-1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No exclusion list anywhere in classification or parser selection; a file the toolchain cannot read is one with no whitelist row
- [x] #2 The lint and the language server agree on `.css.liquid` / `.js.liquid`: both exclude them, where previously only the LSP did
- [x] #3 An Asset is never handed the Liquid+HTML parser
- [x] #4 A dotted filename segment that is not in the platform's FORMAT_ENUM stays part of the NAME (`modal.frame.liquid`, `user.avatar.liquid` still parse)
- [x] #5 Full suite green and the four real projects unchanged in file set and offense totals
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed 2026-08-02.

Files: `app/types.ts` (the whitelist, `sourceKeyOf`), `path-utils.ts`
(`isSupportedSourceFile`, now two clauses), `path-utils.spec.ts`, `CLAUDE.md`.

## One behaviour change, deliberate: `.scss.liquid`

`scss` is NOT in the platform's FORMAT_ENUM, so `views/partials/foo.scss.liquid` is a
partial the platform names `foo.scss` and renders as html. The old regexp excluded it
anyway. Keeping that exclusion would have meant naming `scss` in an ignore list —
precisely what this task removes — so it is now read as Liquid.

Low risk: a survey of double-extension `.liquid` files across arabbank, Accala-MP,
htevent and pos-module-community found `json` (375), `frame` (34), `html` (53),
`csv` (17), `xml` (2) and `js` (3), and **no `scss` at all**. `frame` is the only
non-format segment in real use and it still parses, as a name.

Pinned by an `it.each` in `path-utils.spec.ts` that spells out the reasoning.

## Verified

- Fixture that produced 2 `LiquidHTMLSyntaxError` before now produces 0.
- Full monorepo: 294 files, 2708 tests, 0 failures (was 2700; +8 for the new cases).
- All four real projects: file sets unchanged (946 / 3139 / 2789 / 2895, 0 added,
  0 removed) and offense totals identical per-check (43 → 43, 9623 → 9623).
<!-- SECTION:NOTES:END -->
