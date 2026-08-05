---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
'@platformos/platformos-language-server-common': patch
'@platformos/platformos-mcp-supervisor': patch
---

An asset is served, never rendered — so nothing reads one, anywhere in the toolchain.

`app/assets/x.liquid` was linted like a page. A bare `.liquid` has no response format, so
`sourceCodeTypeOf` falls back to the `html.liquid` key — which HAS a parser row — and the
file went into the app with the Liquid+HTML parser. Measured: a broken one drew
`LiquidHTMLSyntaxError` from `check()`, and through the MCP supervisor a
`must_fix_before_write: true` — a **false block** on a file the platform hands back
byte-for-byte, for the syntax of a language nothing at that path evaluates. Backwards
besides: `theme.css.liquid`, the asset form the platform genuinely does process, was exempt
all along, because `css` IS a format and has no row.

**The rule is a TYPE question, which is why an extension table could never answer it.**
`isParsedFileType` (new, exported from `platformos-common`) is false for
`PlatformOSFileType.Asset` and true for everything else. `App.findOrLocate` had already
written the principle down — *"Nothing reads an asset, so the only question about one is
whether it exists"* — this makes it enforceable.

Applied in exactly two places, and that is the whole design: `AppFile`'s constructor (so a
file's `type` is `undefined`, which is already the toolchain's canonical "do not parse
this") and `isSupportedSourceFile`. Every consumer follows from one of those two without
knowing the rule exists — the linter, because `check()` iterates source types; the language
server, because `App.sourceCodes()` filters on `type !== undefined`; the MCP supervisor,
whose pre-lint gate now asks the shared predicate instead of comparing to `Asset` itself.

An asset is still HELD by the app, and the distinction matters: not linted is not absent.
Dropping assets from the model would produce the same zero offenses while silently breaking
every `asset_url` resolution and the graph's asset nodes.

**Why an explicit exclusion of one type rather than a whitelist of the other eighteen.**
A whitelist gives a NEW `PlatformOSFileType` the default "not read", which is silent and
wrong in the expensive direction — a newly added YAML type would simply stop being linted,
the exact regression `file-type-coverage.spec.ts` exists to catch. Defaulting a new type to
"read" fails loudly instead.

This is also not the ignore-list that `isSupportedSourceFile` is documented to refuse. That
one was a regex inside a single predicate, so the language server honoured it while the lint
did not; this is a shared exported rule consulted by both deciders, so they cannot hold
different opinions.

Closes the write-gate half shipped earlier as a supervisor-only fix, which corrected
`must_fix_before_write` while the CLI and editor still reported on assets.
