---
'@platformos/prettier-plugin-liquid': minor
---

The printer prints the platformOS tag forms the parser now models, instead of passing their
markup through as raw text.

This is the other half of the grammar work, and it is a MINOR rather than a patch because the
printer emits node types it previously never saw. `liquid-html-parser` is tolerant: a tag whose
strict rule does not match keeps its markup as a raw **string**, and the printer emits raw
strings verbatim — which is exactly why an unmodelled tag survives a format today. The moment
the grammar starts parsing one, the printer has to know how to print it, or the construct is
regenerated wrong.

Printed and fixtured here: hash assignment targets (`{% assign a["k"] = v %}` and the same
lvalue on `function` and `hash_assign`), `background`, `try`/`rc`, `function`, and the
filtered-expression operands the platform accepts.

**`@prompt` is the case worth stating.** It is Shopify Magic's AI-provenance annotation,
platformOS publishes no such thing, and the grammar stopped modelling it. Because the printer
REGENERATES source from the AST, anything the AST stops carrying is deleted from the author's
file on the next format, silently — so the removal ships with a fixture
(`src/test/liquid-doc-prompt`) asserting that a `@prompt` line degrades to text and survives a
format intact, rather than being dropped.

Note on the version: this lands at 0.1.0 rather than 0.0.18. A release on 2026-07-21 published
0.0.18 to npm without its version commit reaching `master`, so a patch bump here would have
resolved to a version that already exists — which `changeset publish` skips with a warning
rather than failing, leaving the repo claiming a version whose published contents are different
code.
