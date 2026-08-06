---
'@platformos/liquid-html-parser': patch
'@platformos/platformos-check-common': patch
'@platformos/platformos-mcp-supervisor': patch
'@platformos/prettier-plugin-liquid': patch
---

`FilterWithoutEffect` now matches what the runtime actually does with a filter — in both
directions. Found by running the check over a real project (130 warnings in
`pos-module-community` alone) and settled by probing a live instance, reading the affected value
back rather than checking that the page rendered.

**The discriminator is which Ruby parser receives the value**, not which tag it belongs to:

| parser                                     | filters | positions                                                              |
| ------------------------------------------ | ------- | ---------------------------------------------------------------------- |
| `Liquid::Variable`                         | APPLY   | `{{ }}`, `assign`, `hash_assign`, `session`, `echo`, `print`, `return` |
| `Liquid::JsonLiteralVariable`              | APPLY   | an argument value that IS a JSON literal                               |
| `TAG_ATTRIBUTES` scan                      | DISCARD | every other operand and argument value                                 |
| `Expression.parse` over a `QuotedFragment` | DISCARD | tag operands                                                           |

Four fixes fall out of that table.

**`hash_assign` applies its filters** and was missing from the applying allowlist, so every
`{% hash_assign post['edited_at'] = 'now' | to_time | json %}` was reported as dead code. It is
`assign`'s deprecated twin and shares its RHS handling, so only the mechanism predicts it — no
per-tag probe would have.

```
{% assign h = {} %}{% hash_assign h['k'] = 'a' | upcase %}{{ h['k'] }}   -> A
```

**A JSON-literal argument value applies its filters**, so `{% log 'm', data: {"a": 1} | json %}`
was a false positive — and an increasingly common one now that `parse_json` is deprecated in
favour of hash literals. Measured with a partial that reads the argument back: it was handed the
JSON _string_, and `| json | upcase` arrived as `{"A":1}`, both filters in order. The value
shape decides this, not the tag, which is why it cannot be another allowlist row. A filter
NESTED inside the literal (`data: {"a": 'z' | upcase}`) is a converter syntax error, so nothing
there is exempt.

**A trailing filter is a result filter on `{% graphql res = 'file' %}` and on nothing else.**
This was a false NEGATIVE — the check was silent on genuinely dead code, which is the direction
that ships a file doing something other than what its author wrote:

```
{% function r = 'p', a: 1 | dig: 'x' %}      dig is scanned as one more ARGUMENT; r unfiltered
{% background j = 'p' | dig: 'x' %}          job id comes back unfiltered
{% graphql g, a: 1 | dig: 'x' %}…            INLINE form drops it
{% graphql g = 'q', a: 1 | dig: 'x' %}       the ONE that filters the result
```

All four share one grammar rule and one plausible Ruby story, and every "renders clean" probe
says the same thing about all four — only reading the assigned value back separates them. The
trailing filter binds to the LAST argument, so it survives exactly when that argument is a JSON
literal (`{% function r = 'p', items: [1, 2] | reverse %}` really does reverse `items`).

**`background`'s trailing filter was also a grammar gap**, independent of the above:
`{% background j = 'p' | upcase %}` did not parse at all — a `LiquidHTMLSyntaxError`, which is
`error` severity and in `BLOCKING_CHECKS`, so it blocked writes on markup the platform accepts
and runs. `BackgroundMarkup` now carries `filters` and the printer emits them; without that last
part the next format would have silently deleted the filter.

The AST parks a trailing filter on the markup node (`FunctionMarkup.filters` and friends) even
where the runtime binds it to the last argument. That is a parsing choice that keeps the
author's text round-trippable, and it must not be read as "this is a result filter" — the check,
not the AST shape, carries the runtime meaning. The MCP server's instructions previously told
agents that `function`/`graphql` trailing filters filter the result; that claim is corrected and
now pinned.
