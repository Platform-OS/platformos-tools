---
'@platformos/platformos-check-common': major
'@platformos/platformos-check-node': major
'@platformos/platformos-mcp-supervisor': patch
---

**BREAKING**: `InvalidHashAssignTarget` is renamed to `InvalidWriteTarget`. A
`.platformos-check.yml` that configures it by the old name must be updated; the CLI reports
an unknown check otherwise.

The old name described one of the five constructs the check judges. Its subject is a write
that goes INTO a container — a subscript write or an append — and three tags spell one:

```liquid
{% assign      x['k'] = v   %}   {% assign   x << v   %}
{% hash_assign x['k'] = v   %}   {% function x << 'p' %}
{% function    x['k'] = 'p' %}
```

`{% function x['k'] = 'p' %}` is newly judged. Its silence was documented as "the write
semantics are unmeasured — it needs a partial that exists, and the oracle instance has
none", which was wrong: measured against `/api/app_builder/liquid_exec` with the container
read back, it obeys the rule identically to the other two spellings, error text included.

| container | `x['k'] = …` | `x[0] = …` |
| --- | --- | --- |
| Hash | writes | writes (key `"0"`) |
| Array | raises *"x is an Array, expected index, k was provided"* | writes |
| String / Number / Boolean / Range / Date / Time / unset | raises *"x is …, expected Hash or Array"* | same |

Also measured and now covered: `date`, `time` and `range` targets for `<<`, and
`{% function x.k = 'p' %}`, which writes the key `k` exactly as `{% assign %}` does.

The messages no longer name the tag, because the rule is the write's and not the tag's —
`assign expects a Hash or an Array` was a false statement about `assign`:

- `Cannot write into 'x', which is a number. A subscript write needs a Hash or an Array.`
- `Cannot write into 'x' with a string key, because it is an Array. Use a numeric index instead.`
- `Cannot use '<<' on 'x', which is a Hash. '<<' appends to an Array.`

An append offense no longer highlights the whitespace before the closing `%}`.

Separately, `LiquidHTMLSyntaxError` now reports a `hash_assign` with no subscript at all.
`{% hash_assign h = 'v' %}` parses in this repository — the markup rule is a
`liquidVariableLookup`, which matches a plain name — and raises `Liquid::SyntaxError` on the
platform whatever the target holds, so a Hash target was a silent false approval on a
blocking check. It shares the dot form's message, since both have the same repair: rename
the tag to `{% assign %}`, which accepts every target `hash_assign` refuses.
