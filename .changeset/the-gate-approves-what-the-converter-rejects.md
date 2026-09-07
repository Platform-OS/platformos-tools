---
'@platformos/liquid-html-parser': patch
'@platformos/platformos-common': patch
---

Report ten shapes that passed the gate and then failed the deploy: a GraphQL description, a
BOM, and `comment`/`raw`/`doc` blocks that never close.

Both halves are the same mistake — we and the platform parse the same format with different
libraries, and nobody had run the differential. A 50-case GraphQL corpus and a 21-case Liquid
corpus were run against the parsers the platform actually uses, `graphql-c_parser` 1.1.3 and
Shopify `liquid` 5.11.0 under `error_mode: :strict`, and confirmed against a live
`pos-cli deploy --dry-run`. Every divergence ran one way: we approved, the converter refused,
and a converter rejection fails the WHOLE changeset rather than the one file.

GRAPHQL. graphql-js 16 ships the operation-descriptions proposal unconditionally, and there is
no parser option to turn it off, so a stored query documented the obvious way parsed here and
was a syntax error there:

```graphql
"""
Loads one checklist by its database id.
"""
query checklist_find($id: ID!) {   # syntax error, unexpected QUERY ("query") at [4, 1]
```

Descriptions on an operation, a fragment definition and a variable definition are now reported,
as is a leading UTF-8 BOM — whitespace to graphql-js's lexer, an invalid token to the platform's.
A description on a TYPE-SYSTEM definition is untouched: that one is in both grammars.

These come back as a syntax error with no parsed document, which is the literal truth — the
platform has no parse of the file. `GraphQLCheck` reports it and already blocks the write.

LIQUID. `comment`, `raw` and `doc` are the three tags whose closed form becomes a `LiquidRawTag`,
and an unclosed one fell in the gap between two mechanisms: the tolerant parser falls back to a
bare tag, which leaves nothing open for the unclosed-block check to find, and those three names
are exactly what `InvalidTagSyntax` exempts, because empty markup IS correct for a closed raw
tag. So a forgotten `{% endcomment %}` parsed silently. The other 13 block tags were already
reported.

```liquid
{% liquid
  comment Sharing starts off, so a real token must not open the list yet. endcomment
  function denied = 'queries/checklists/authorize'
%}
```

Inside `{% liquid %}` each line is one tag, so `comment` swallows the trailing `endcomment` as
markup and then looks for a closer on the following lines: `'comment' tag was never closed`.
`raw` is worse — it can never be used inside `{% liquid %}` at all, however it is written,
because Liquid scans for the full `{% endraw %}` tag, which a body of one bare tag per line
cannot contain.

The messages are the Liquid runtime's own wording, the way the other block tags already report
them, so a reader who sees one message and then the other has nothing to translate.

What deliberately did NOT change: `{% comment junk %}…{% endcomment %}` still parses, because
markup on `comment` is legal on the platform; a multi-line `comment` inside `{% liquid %}` still
parses, because Liquid matches that closer as a bare line; and `{% raw junk %}` still parses,
because the printer repairs it by stripping the argument and cannot repair what the parser
refuses to read.
