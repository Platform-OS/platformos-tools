---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': patch
'@platformos/platformos-mcp-supervisor': patch
---

A `{% liquid %}` block silently ends at the first `%}` inside it — new `TruncatedLiquidBlock`.

The `{% liquid %}` lexer looks for its closing `%}` with no awareness of comments or quoting, so
the first one anywhere in the block terminates it. The statements after it never run; they are
re-read as template TEXT and rendered into the response body. **Nothing raises** — the page
returns HTTP 200 and `liquid_exec` answers `ok: true, error: null`.

```liquid
{% liquid
  # a comment mentioning %} the closing sequence
  assign doubled = 21 | times: 2
%}RESULT=[{{ doubled }}]
```
renders `" the closing sequence\n  assign doubled = 21 | times: 2\n%}RESULT=[]"` — the block's
own source, served to the client, with `doubled` never assigned.

**It is not a comment rule**, which is the intuitive reading and the wrong one. Measured, a `%}`
inside a *string literal* truncates identically with no comment involved:

```liquid
{% liquid
  assign s = "a %} b"
  assign doubled = 21 | times: 2
%}
```

In a `lib/` partial the truncation usually swallows the `return`, and the runtime then raises
**"function must return a value"** against a `return` statement that is present and correct.
Naming the wrong construct is this defect's real cost, which is why the offense highlights the
`{% liquid %}` block rather than the stranded delimiter or the downstream symptom.

Nothing reported it before: the CLI emitted at most an incidental `UndefinedObject` pointing at
the variable, the supervisor answered `status: ok`, and the runtime rendered 200.

**It blocks the write.** The platform does not reject the file, so this is one of the few members
admitted on consequence rather than on a converter rejection — the same ground as
`MissingContentForLayout`, whose HTTP-200-with-the-body-silently-dropped is the identical
profile. The false-block risk was measured, not argued: the detector fired **zero** times across
7250 real `.liquid` files holding 6274 `{% liquid %}` blocks.

**No autofix, deliberately.** Both repairs are measured to work — `assign s = "a %" | append:
"} b"` renders `a %} b`, and a comment moved into `{% comment %}…{% endcomment %}` renders — and
the message names them. What is missing is a trustworthy input: the parser stopped at the
delimiter, so the author's intended block survives only as raw text on the far side of the
truncation. Rewriting from that means re-lexing by hand the exact region whose lexer created the
defect, and an autofix is applied without review.

Reaches all three consumers, verified end to end rather than assumed: `pos-cli check run`, the
MCP supervisor's `validate_code`, and the language server's published diagnostics.

Worth recording for whoever meets it next: a literal `%}` cannot appear in ANY Liquid string. A
standalone `{% assign s = "a %} b" %}` truncates the same way, and `{{ "a %} b" }}` raises
`Variable '{{ "a %}' was not properly terminated`. That output-lexer case is a separate,
still-unreported defect and is tracked on its own.
