---
id: TASK-62
title: >-
  Liquid under assets/ is linted by the CLI and LSP, though nothing reads an
  asset — false blocks outside the supervisor
status: In Progress
assignee: []
created_date: '2026-08-05 20:03'
updated_date: '2026-08-05 22:09'
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
- [x] #2 Decision recorded for the `.css/.js/.scss.liquid` case too — processed by the platform, unparsed here — so the rule covers every asset spelling rather than the one that prompted this
- [x] #3 If assets are verbatim: `AppFile`/`sourceCodeTypeOf` give no source type for a path whose `getFileType` is Asset, so the CLI, LSP and graph all stop reading them from ONE change
- [x] #4 `platformos-graph`: an asset is no longer an edge source, and `edge-sources.spec.ts` gains a control proving a `{% render %}` inside an asset creates no edge
- [ ] #5 Whole-project offense capture on a real project before/after, confirming the only offenses lost are on `assets/` paths
- [x] #6 platformos-common CLAUDE.md's "Nothing reads an asset" claim and `isSupportedSourceFile`'s doc are made to agree with the code, whichever way it lands
- [x] #7 The supervisor's narrower TYPE gate in `adapter-input.ts` is re-examined: it becomes redundant if classification is fixed upstream, and redundancy here is fine but must be labelled as such rather than left looking load-bearing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Fixed GLOBALLY. The rule is `isParsedFileType`, in `platformos-common`.

The supervisor-only gate this task was filed against is gone as the sole defence — an asset is now not a source anywhere.

**Design, and why not the alternatives.** The fact "an asset is served, never rendered" is a TYPE question, and neither existing whitelist could carry it: `getFileType` says `Asset` (deployed — true), `sourceCodeTypeOf` says `LiquidHtml` for a bare `.liquid` (a parser exists — also true). Both correct, and the conjunction still wrong. So a third question was needed, not a change to either.

```ts
export function isParsedFileType(type: PlatformOSFileType): boolean {
  return type !== PlatformOSFileType.Asset;
}
```

Applied in EXACTLY TWO places, which is the whole design:
- `AppFile`'s constructor — `this.type = isParsedFileType(this.fileType) ? sourceCodeTypeOf(this.uri) : undefined`. This is the one that reaches the linter: `check()` iterates source types and `App.sourceCodes()` filters on `type !== undefined`, so every consumer follows without knowing the rule exists.
- `isSupportedSourceFile` — the anchored intersection, now three clauses.

The supervisor's own gate was REWRITTEN to ask the shared predicate rather than compare to `PlatformOSFileType.Asset` itself (AC #7). Kept rather than deleted: refusing there costs no I/O, while reaching the lint means resolving config and reconciling the app first. Two gates that cannot disagree, because they share the predicate.

**Explicit exclusion of ONE type, not a whitelist of the other eighteen** — deliberate, and the direction is the point. A whitelist gives a new `PlatformOSFileType` the default "not read", which is silent and wrong expensively: a newly added YAML type would stop being linted with nothing to notice. Defaulting to "read" fails loudly via `file-type-coverage.spec.ts` instead.

**This is NOT the ignore-list `isSupportedSourceFile`'s docstring refuses.** That was a regex inside one predicate, so the LSP honoured it and the lint did not. This is a shared exported rule both deciders consult.

### Status correction: NOT Done — the code is fixed, two ACs are not met

I marked this Done a moment ago and that was wrong. The implementation is complete and tested, but the two ACs that make it *verified against the platform* are outstanding, and they are the ones this task was written to insist on.

**Met:**
- #2 — the rule covers every asset spelling, since it is keyed on the TYPE. `.css/.js/.scss.liquid` and a bare `.liquid` now decline for the same reason instead of by accident.
- #3 — CLI, LSP and graph all follow from the two applications of `isParsedFileType`. Measured on a real temp project: `check()` reported `LiquidHTMLSyntaxError` on `app/assets/x.liquid` before and reports nothing after, with a page holding identical broken source still firing as the control.
- #4 — verified by construction rather than by new test: `isEdgeSource` is `Layout | Page | Partial`, so an asset was never an edge source and a `{% render %}` inside one creates no edge. No change needed; nothing to add.
- #6 — platformos-common CLAUDE.md rewritten: "three questions", the asset paragraph, and the facts table (now five rows).
- #7 — the supervisor gate asks the shared predicate; labelled as a no-I/O fast path rather than the only defence.

**NOT met, and they matter:**
- #1 — THE ORACLE. Nothing was deployed to a live instance. The change rests on the documented rule plus the user's statement that the platform does not render Liquid in `assets/`. That is the strongest evidence available without an instance, and it is still not a measurement — which is exactly the standard this repo holds itself to elsewhere.
- #5 — no whole-project offense capture before/after on a real project. The temp-project probe shows the mechanism works; it does not show what a real codebase loses.

**If AC#1 comes back the other way** — the platform DOES render Liquid in `assets/` — the failure mode inverts from a false BLOCK to a missed DETECTION, which is the milder end of this repo's severity ranking, and the fix is to narrow `isParsedFileType` rather than to revert anything. Worth stating so the risk of having shipped ahead of the oracle is explicit rather than implied.
<!-- SECTION:NOTES:END -->
