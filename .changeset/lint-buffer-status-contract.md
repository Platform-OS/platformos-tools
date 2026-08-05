---
'@platformos/platformos-check-node': minor
'@platformos/platformos-mcp-supervisor': patch
---

`lintBuffers` says whether it checked the file, and the supervisor turns that into advice an
author can act on.

An empty `Offense[]` means "no problems found" only when something looked. For a path the
config excludes, an asset, or a file outside every deployed subtree it means "never
examined", and the two are indistinguishable at the call site. `lintBuffer`/`lintBuffers` now
return `{ status, offenses }` with a five-value `LintBufferStatus`: `checked`,
`excluded-by-config`, `misplaced-source`, `not-a-platformos-file`, `not-a-source-file`.

The two out-of-app cases are split HERE, where classification happens, so an embedder never
re-derives the distinction from a raw path — and it matters because the remedies are
opposite. A `.liquid` outside every deployed subtree is a platformOS source the platform will
never load: dead code, and the author needs to hear that. A `.jsx` component in `src/` is a
file that was never meant to be platformOS code, and telling its author to "move it under
`app/`" is wrong advice. The supervisor maps these to `misplaced_source` and
`unsupported_type` through one total table, so a status added upstream fails the BUILD at the
point where someone has to decide what the agent should hear, rather than falling into a
catch-all and reporting a plausible wrong reason.

Neither blocks a write. A misplaced source is very likely a mistake, but "likely" is a guess
about intent — a fixture or a generator template lives there legitimately — and a gate that
vetoes legitimate work on a guess gets switched off.

**An asset is never judged, decided by TYPE rather than by whether a parser accepts the
extension.** `app/assets/x.liquid` holding `{% if unclosed` returned
`must_fix_before_write: true` with `LiquidHTMLSyntaxError`: a bare `.liquid` has no response
format, so it fell back to `html.liquid` and reached the Liquid parser. Exactly backwards —
`app/assets/theme.css.liquid`, the asset form the platform DOES process, was exempt all
along. Nothing reads an asset, so nothing about one can block a write.

Also: `fingerprintOf` and `isKnownFingerprint` are exported for an embedder running its own
never-stale cache over the same project. The sentinel itself stays private — it equals
itself, so a cache that STORES it for an unreadable file would compare equal on the next scan
and call the file unchanged forever.
