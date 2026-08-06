---
'@platformos/liquid-html-parser': minor
'@platformos/platformos-check-common': patch
'@platformos/prettier-plugin-liquid': patch
---

The grammar models platformOS's own tags instead of leaving their markup as raw text.

`liquid-html-parser` is a Shopify fork, and platformOS is not Shopify: a dozen tags the
platform registers had no strict rule here, so their markup survived as an unparsed string.
The parser is TOLERANT, so nothing threw — which is exactly why this was easy to miss. Absence
of an error is not evidence the grammar understands a construct; `typeof node.markup` is.

Now modelled, with their arguments and filters: `cache`, `cycle`, `export`, `function`,
`log`, `redirect_to`, `response_headers`, `response_status`, `spam_protection`, `yield`, and
the `case`/`when` operands. Filtered expressions are handled where the platform accepts them
(`liquidFilteredExpression`, `tagArgumentValueWithFilters`), which is what lets
`FilterWithoutEffect` see a filter that the runtime will parse and then discard.

**The printer moves with the grammar, and that is the part worth stating.** The Prettier
plugin REGENERATES source from the AST, so anything the AST does not carry is deleted from
the author's file on the next format — silently. A construct whose markup is a raw string
survives formatting today precisely because the printer emits raw strings verbatim; the
moment it parses, the printer has to know how to print it. Fixtures for the new forms ship
with this change for that reason, not for completeness.
