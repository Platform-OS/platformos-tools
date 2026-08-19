---
'@platformos/liquid-html-parser': minor
'@platformos/platformos-check-common': patch
'@platformos/prettier-plugin-liquid': patch
'@platformos/platformos-mcp-supervisor': patch
---

A space between a variable and its key path is a PARSE error on the platform, in a write target only.

`{% assign h ['k'] = 9 %}` parsed here and is refused by platformOS. Measured against
`/api/app_builder/liquid_exec` and, because a syntax claim is only settled by the converter,
against `pos-cli deploy --dry-run` — which REJECTS it 2/2 with its space-free control accepted.
A converter rejection fails the WHOLE changeset, so this was a false approval with the same
blast radius as `{% layout %}`: the gate said `must_fix_before_write: false` and the deploy took
every other file down with it.

The platform's own rule is one regex — `LHS_PATTERN` in `app/lib/liquify/tags/hash_assignable.rb`:

```ruby
MIXED_KEYS_PATTERN = '(?:\.[\w\-]+|\[.+?\])+'
LHS_PATTERN        = "(#{VARIABLE_NAME})(#{MIXED_KEYS_PATTERN})?"
```

There is no `\s*` between the name and the key path, and the alternation covers `.foo` as well as
`[…]`. So the constraint is **no whitespace between a variable and the start of its key path**, both
accessors — not "no space before a subscript", which is how it was filed. Three tags share that
pattern, and all three were affected, each with its own error text:

```liquid
{% assign h ['k'] = 9 %}        Syntax Error in 'assign'
{% assign h .k = 9 %}           Syntax Error in 'assign'
{% hash_assign h ['k'] = 9 %}   Syntax Error in 'hash_assign'
{% function r ['k'] = 'p' %}    Invalid syntax for function tag
{% assign a ['z'] << 'x' %}     Syntax Error in 'assign'      <- the append operator too
```

**Scoped to write targets, and that is the whole design.** The identical spelling in a READ resolves
correctly on the platform, so narrowing the shared `lookup` rule would have traded one false approval
for six false blocks — strictly the worse bug, since a false block cannot be overridden:

```liquid
{{ h ['k'] }}   {{ h.a [0] }}   {{ h[ 'k' ] }}
{% assign v = h ['k'] %}   {% if h ['k'] %}   {% echo h ['k'] %}
```

`lookup` and `liquidVariableLookup` are therefore untouched; `assignTarget` and the `hash_assign` /
`function` markups take a new target-only rule. `{% liquid %}` bodies inherit it, because that
grammar only redefines `space`. The AST shape is unchanged, so stage 2, the printer and the language
server needed no change — the two stage-1 additions are passthrough mappings.

**A space INSIDE the brackets stays legal**, because `\[.+?\]` matches it, and so does a spaced
bracket that follows another bracket — `h['a'] ['b']` assigns. Both were measured rather than
assumed, and the first version of this change refused the second one: a false block, caught only by
re-checking every spelling against the instance instead of trusting the unit tests.

The printer now emits a refused target VERBATIM. It used to repair the spacing by accident, which hid
the error from anyone who formatted and left it in place for everyone who did not.

Known gap, pinned rather than left implicit: `{% assign h.a ['b'] = 9 %}` — a spaced bracket after a
DOT — is still accepted and the platform refuses it. Expressing "spaced bracket only after a bracket"
needs a recursive chain that would replace the flat `lookups` iteration the stage-1 mapping indexes,
so it stays as it was, with a test asserting today's behaviour so it cannot be mistaken for covered.

Verified on a real 2 768-file application: `pos-cli check` reports 13 225 offenses over 2 002 files,
byte-identical to before, and `LiquidHTMLSyntaxError` still exactly 122 — no new offense on code that
ships.
