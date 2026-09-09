---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
'@platformos/platformos-mcp-supervisor': patch
---

Stop refusing three tag spellings that platformOS parses as intended

`{% capture 'name' %}`, `{% case x: %}` and `{% parse_json v %%}` were reported by
`InvalidTagSyntax`, which lands under `LiquidHTMLSyntaxError` — `Severity.ERROR` and a member
of the MCP supervisor's blocking set — so an agent was told not to write the file at all. On a
2,768-file production application these accounted for **34 of the 122** `LiquidHTMLSyntaxError`
offenses, 32 of them `{% capture 'name' %}`, the most frequently refused construct in real
code. Every one was rendered on a live instance and produces the author's intended result.

They now report as `UnconventionalTagSyntax` at `warning`, which is outside the blocking set:
still advised against, no longer fatal. Corpus totals are otherwise identical — 13,065 offenses
across 1,950 files before and after, with `LiquidHTMLSyntaxError` 122 → 88 and the 34 moving to
the new check.

The admitted set is a deliberate allowlist, not a relaxation of `InvalidTagSyntax`. The
platform matches tag markup with an unanchored regex, so it also accepts spellings that then do
the wrong thing **silently** — a mistyped `{% cache: k %}` collapses the cache key to a
constant, and because the full key carries no user component, distinct keys share one entry
across the instance and one user's rendered fragment is served to another. Those keep blocking,
and are asserted alongside the demoted ones so the two halves cannot drift apart.
