---
'@platformos/platformos-check-common': minor
'@platformos/prettier-plugin-liquid': patch
'@platformos/platformos-mcp-supervisor': patch
---

`hash_assign` is not the only tag that writes into a Hash, and it is the deprecated one.

`{% assign h['k'] = v %}` and `{% assign h.k = v %}` reach the same runtime setter as
`{% hash_assign %}`. `InvalidHashAssignTarget` knew only the old spelling, which cost two
defects in opposite directions — and both are settled by measurement against
`/api/app_builder/liquid_exec`, every row reading the container back so "accepted" means the
write happened rather than that the tag merely parsed.

**A FALSE BLOCK, in a check that gates the write.** A subscript write was treated as a plain
assignment, so `h` took the VALUE's type: after `{% assign h['k'] = 'V' %}`, the next write to
the same hash was refused as a write onto a *string*. Both spellings, one file apart:

```liquid
{% assign h = '{}' | parse_json %}
{% assign h['k'] = 'V' %}
{% hash_assign h['j'] = 'W' %}   <- "h ... is a string" — and the platform renders it
```

A write INTO a container does not replace it. The container's type is now preserved, and
NARROWED where the write itself proves it: reaching the runtime at all means the container was
of the right kind.

**A MISSED DETECTION.** `{% assign x['k'] = v %}` onto a String, Number, Boolean, nil or an
unset variable raises `"x is …, expected Hash or Array"`, and an Array subscripted with a
string key raises `"expected index"` — identical to `hash_assign` in all fourteen container ×
subscript combinations. None of it was reported. It is now, under the tag the author actually
wrote.

**`{% assign x << v %}` is a separate rule and was wrong in both directions too.** It requires
an Array — a **Hash raises**, which is the falsifier proving it is not the subscript-write rule
wearing a different operator — and it does not replace the target either, so appending a number
to an array no longer makes every later write to it look like a write onto a number.

**The dot rule does NOT generalise, and that is the measured half people get wrong.**
`{% hash_assign h.k = v %}` raises a PARSE-time `Syntax Error in 'hash_assign'`;
`{% assign h.k = v %}` writes the key `k`. So `InvalidHashAssignTargetSyntax` stays
`hash_assign`-only — extending it would refuse working code on a blocking check — and a dot
lookup counts as a plain KEY accessor everywhere else, exactly as the runtime treats it.

`{% function h['k'] = 'partial' %}` parses in every target spelling but its write semantics
could not be measured (it needs a partial that exists, and the oracle instance has none), so it
is deliberately not judged and the gap is pinned by a test with a live control.

The MCP server's instructions now describe the rules under `assign` rather than only under
`hash_assign`, since telling an agent about a deprecated tag's constraints teaches it a rule
that does not apply to the tag it should be writing.

**And the formatter was destroying these targets, which is worse than any of the above.**
`prettier-plugin-liquid` normalised a subscript away on every format:

```liquid
{% assign h['k'] = 'V' %}        ->   {% assign h.'k' = 'V' %}      ✗ no parser accepts this
{% function h['k'] = 'p' %}      ->   {% function h.k = 'p' %}      ✗ target silently rewritten
```

The `assign` output is not even the dot form — the printer emitted the string NODE after the
dot, quotes included. Measured: `Liquid syntax error: Syntax Error in 'assign' - Valid syntax:
assign [var] = [value]`, at PARSE time. So format-on-save turned a working file into one that
can neither be deployed nor rendered, with no error at any layer, and a converter rejection
takes the whole changeset. This is the same defect that was fixed for `hash_assign` earlier,
in the two tags it was not fixed for.

Both targets are now bracketed throughout — `h.a['b']` becomes `h['a']['b']`, and an author's
`h.k` becomes `h['k']`, which is behaviour-preserving and was measured pair by pair against the
runtime rather than reasoned about. Dot access is still preferred everywhere that is not a
write target. The invariant is asserted against LIVE printer output, not against the committed
`fixed.liquid`, because a fixture regenerated from a broken printer records the breakage as the
expectation — which is exactly what `liquid-tag-function/fixed.liquid` had done.
