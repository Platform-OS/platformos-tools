---
'@platformos/platformos-check-common': minor
'@platformos/platformos-mcp-supervisor': patch
---

Add `InvalidFrontmatterSyntax`: malformed YAML inside a frontmatter block rejects the deploy
and was reported by nothing.

```liquid
---
slug: probe
	layout: application        ← a tab
---
```

Measured: `Body contains invalid YAML: found a tab character that violates indentation`,
exit 1 — and a rejection fails the whole changeset. An unclosed flow sequence
(`layout: [unclosed`) does the same. `validate_code` answered `status: ok` for both.

The machinery existed and worked — the identical YAML in a standalone `.yml` file reports
`YAMLSyntaxError` and blocks — but that check declares `SourceCodeType.YAML`, and the engine
runs a check only against files of its own type, so a `.liquid` file never reached it. The
frontmatter block was already being parsed; its `errors` were discarded.

This settles the tab-indentation question left open in the upstream audit: the converter
rejects it and the linter said nothing.

**One mistake, one diagnostic.** `parseDocument` recovers and returns a partial map, so the
field-level rules would otherwise report on whichever half of a broken block survived — an
`unknown_key` that is only unknown because the parse fell apart beside it. Those rules now
read the block through `wellFormedFrontmatterBlock` and stand down when it does not parse;
a control in the same test proves they still fire once it does.

Messages come from our parser rather than being written to match the platform's. The linter
reads YAML 1.2 (npm `yaml`) and the platform reads YAML 1.1 (Ruby Psych); both refuse a tab
and an unclosed flow collection, but they are not the same parser and the tests pin the
range rather than the wording.

Also corrected: `YAMLSyntaxError`'s docblock and `blocking.ts` both recorded that "the
converter accepts unknown property types". A real deploy rejects them (`Attribute type `x`
is not allowed`); `--dry-run` accepts only because it returns before the nested converter
that validates them. The syntax-only scoping stands, but on "no shape check exists yet"
rather than on platform permissiveness. That gap is now tracked separately.
