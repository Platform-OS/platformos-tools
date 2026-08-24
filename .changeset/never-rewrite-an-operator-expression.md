---
'@platformos/platformos-check-common': patch
---

Stop `LiquidHTMLSyntaxError` from rewriting a Liquid expression into a different, valid
program.

`pos-cli check run -a` on `{% assign x = flag ? 'yes' : 'no' %}` produced
`{% assign x = flag %}`, printed "No offenses found", and the rewritten file then passed
`pos-cli deploy --dry-run` clean. `x` is `true` — neither `'yes'` nor `'no'`. The converter
REJECTS the original and ACCEPTS the rewrite, so the linter was trading a whole-changeset
failure for a page that renders a value nobody wrote, with no error left at any layer.

Three detectors repaired unsupported markup by keeping the first value and discarding the
rest. That discard reproduces what platformOS's lax parser does — measured on a live
instance, `{% assign foo = '123' 555 text %}` renders `123` — which is a repair when what
follows is stray tokens and a silent rewrite when it is an operand:

```liquid
{% assign x = flag ? 'yes' : 'no' %}   became   {% assign x = flag %}
{% assign foo = something == else %}   became   {% assign foo = something %}
{{ flag ? 'yes' : 'no' }}              became   {{ flag }}
{% echo a && b %}                      became   {% echo a %}
```

`detectMultipleAssignValues` and `detectInvalidEchoValue` work on raw string markup and now
withhold the fix when the value section contains an operator, via a new quote-aware
`hasExpressionOperator` — `'a?b'` and `-5` stay repairable, a bare `-` and a fused `?b` do
not. `detectInvalidBooleanExpressions` works on a parsed node that is by construction an
author-written comparison or logical expression, so it has no repairable case at all and its
fix is removed outright rather than gated.

The offense is unchanged in message, severity and position, and that is the point: the block
is the mitigation. `LiquidHTMLSyntaxError` is in the supervisor's `BLOCKING_CHECKS`, and it is
the only thing standing between this syntax and a wrong value at runtime — the fix was
removing it.

Its existing spec asserted the corrupted output was correct
(`{% assign foo = something == else %}` → `{% assign foo = something %}`), so that expectation
is replaced rather than extended. The whole contract, with a control that must still repair a
meaningless tail beside every case that must not be touched, lives in
`operator-expressions-are-never-rewritten.spec.ts`.

`||` is deliberately left to `InvalidPipeSyntax`: it repairs to `{% assign x = a | b %}`,
which the converter still rejects ("Unknown filters: b") and `UnknownFilter` blocks, so that
path never fails silently.
