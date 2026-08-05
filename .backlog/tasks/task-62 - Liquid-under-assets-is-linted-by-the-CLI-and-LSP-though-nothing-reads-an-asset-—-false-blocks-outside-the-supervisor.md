---
id: TASK-62
title: >-
  Liquid under assets/ is linted by the CLI and LSP, though nothing reads an
  asset — false blocks outside the supervisor
status: To Do
assignee: []
created_date: '2026-08-05 20:03'
labels:
  - classification
  - false-block
  - platformos-common
  - measured
dependencies: []
priority: high
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`platformos-common` states the rule plainly — "Nothing reads an asset, so the only question about one is whether it exists" — but `sourceCodeTypeOf` disagrees for one spelling, and the whole toolchain follows `sourceCodeTypeOf`.

A bare `.liquid` has no response format, so `sourceKeyOf` falls back to `html.liquid`, which HAS a row in `SOURCE_CODE_TYPE_BY_KEY`. Therefore:

    getFileType('app/assets/x.liquid', root)        -> Asset
    sourceCodeTypeOf('app/assets/x.liquid')         -> LiquidHtml     <-- parses
    isSupportedSourceFile('app/assets/x.liquid')    -> true           <-- MEASURED

Exactly backwards from the one asset form the platform DOES process:

    sourceCodeTypeOf('app/assets/theme.css.liquid') -> undefined      <-- exempt

MEASURED CONSEQUENCE, via the supervisor before it was gated (probe, temp project, default config):

    app/assets/x.liquid            '{% if unclosed'  -> blocked=TRUE  LiquidHTMLSyntaxError
    app/assets/x.liquid            bad filter        -> blocked=TRUE  UnknownFilter
    app/assets/x.html.liquid       '{% if unclosed'  -> blocked=TRUE  LiquidHTMLSyntaxError
    app/assets/nested/deep/w.liquid'{% if unclosed'  -> blocked=TRUE  LiquidHTMLSyntaxError
    app/assets/theme.css.liquid    '{% if unclosed'  -> not_applicable, blocked=false

That is a FALSE BLOCK on the syntax of a language nothing at that path evaluates — the most severe class in this repo's own ranking (silent data loss ~= false block > false approval > missed detection).

ALREADY FIXED FOR THE WRITE GATE ONLY, in TASK-60: `fileApplicability` now refuses `PlatformOSFileType.Asset` by TYPE rather than by whether some parser accepts the extension. `must_fix_before_write` can no longer be set for anything under `assets/`.

WHAT REMAINS, and why it was not folded into the merge: every other consumer still reads `sourceCodeTypeOf`, so `app/assets/x.liquid` is still put in the `App` with the Liquid parser and still reported on by
  - `platformos-check` CLI over a whole project,
  - the language server (diagnostics, completions, hover in a file the platform serves as bytes),
  - `platformos-graph` (an asset becomes an edge SOURCE, so its `{% render %}` calls create graph edges).
Fixing that means making assets typeless at classification time, which touches four packages and the prettier printer, and needs the platform oracle first.

UNMEASURED, AND THE THING TO SETTLE FIRST: does the platform render Liquid in `assets/` at all? The user's position, and the documented one, is that it does not. `.css.liquid` / `.js.liquid` / `.scss.liquid` clearly ARE processed (that is what the double extension means) while having no parser here — so the current code is inconsistent in both directions and neither direction has been checked against a live instance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Oracle settles it: a bare `app/assets/x.liquid` containing Liquid is deployed via `pos-cli deploy --dry-run` and fetched, showing whether the platform renders it or serves it verbatim
- [ ] #2 Decision recorded for the `.css/.js/.scss.liquid` case too — processed by the platform, unparsed here — so the rule covers every asset spelling rather than the one that prompted this
- [ ] #3 If assets are verbatim: `AppFile`/`sourceCodeTypeOf` give no source type for a path whose `getFileType` is Asset, so the CLI, LSP and graph all stop reading them from ONE change
- [ ] #4 `platformos-graph`: an asset is no longer an edge source, and `edge-sources.spec.ts` gains a control proving a `{% render %}` inside an asset creates no edge
- [ ] #5 Whole-project offense capture on a real project before/after, confirming the only offenses lost are on `assets/` paths
- [ ] #6 platformos-common CLAUDE.md's "Nothing reads an asset" claim and `isSupportedSourceFile`'s doc are made to agree with the code, whichever way it lands
- [ ] #7 The supervisor's narrower TYPE gate in `adapter-input.ts` is re-examined: it becomes redundant if classification is fixed upstream, and redundancy here is fine but must be labelled as such rather than left looking load-bearing
<!-- AC:END -->
