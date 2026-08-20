---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
'@platformos/liquid-html-parser': patch
---

Report a Liquid string literal whose closing quote is backslash-escaped, and say what an
unclosed block actually is.

`{{ "it's a \"test\"" | escape_javascript }}` reads, to Liquid, as the string `it's a \`
followed by the markup `test\""`. Liquid literals have no escape sequences, so the quote after
the backslash closes the string. Measured on a live instance (engine `463805653cae`): nothing
raises, the value is silently truncated, and the published example above renders `it\'s a \\`
rather than the `it\'s a \"test\"` its own documentation states.

`LiquidHTMLSyntaxError` used to answer these with `Syntax is not supported` pointed at the
leftover text — and offered an autofix that DELETED that text, which silences the report while
making the truncation permanent. The new `UnsupportedStringEscape` check reports the cause
instead, at `ERROR`, naming the value Liquid holds, the text left outside the string, and the
way to write it (`{% capture %}` for text needing both quote kinds, otherwise the other quote
style). Its four generic readings — `InvalidEchoValue`, `MultipleAssignValues`,
`InvalidConditionalNode` and the `assign` fallback — now stand down for this cause, so one
mistake produces one diagnostic.

It also covers filter arguments, which nothing reported before:
`{{ "abc" | replace: "b\"c", "z" }}` silently replaced nothing.

Deliberately NOT in the supervisor's `BLOCKING_CHECKS`, and with no autofix: the platform
accepts the file, and the tempting mechanical repair (swap the outer quotes) is invalid inside
a JSON literal, where `\"` is a real escape the runtime honours — a context unparsed markup
cannot identify. JSON literals parse strictly, so they never reach the check.

Unclosed blocks now report in the author's vocabulary rather than the parser's. A missing
`{% endif %}` said `Attempting to end parsing before LiquidBranch 'null' was closed`, while
the error's own `unclosed` payload already said `if`; both now come from the same resolved
value, and the message is `'if' tag was never closed` — the wording the Liquid runtime uses
for the same mistake. HTML reads `'<div>' element was never closed`, and the three
mid-document variants use the same vocabulary.
