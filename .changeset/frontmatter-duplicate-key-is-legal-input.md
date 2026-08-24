---
'@platformos/platformos-common': patch
---

Stop treating a repeated frontmatter key as a syntax error, which was hiding every other finding in the block

The frontmatter parse took `yaml`'s default options, where `uniqueKeys` is `true`. A key written
twice therefore became a parse error, and because every field rule reads through
`wellFormedFrontmatterBlock`, that one key silently suppressed `UnknownFrontmatterField`,
`InvalidFrontmatterValue`, `MissingLayout`, `MissingFrontmatterAssociation` and
`DeprecatedFrontmatterField` for the whole block — including findings the deploy converter
rejects the changeset over.

The platform disagrees. It parses frontmatter with `SafeYAML.load` (Psych) and rescues only
`Psych::SyntaxError`; Psych has no uniqueness rule. Measured end to end by syncing a page whose
`slug` was declared twice: it synced without error, the first slug 404s and the second serves.
A repeated key is legal input, resolved last-wins.

`prettyErrors` is now `false` as well. The pretty form appends the offending source line and a
caret diagram to `error.message`, and that message was reported verbatim, so an unclosed bracket
in frontmatter produced a multi-line ASCII diagram as the offense text.

Both options match what `platformos-check-common`'s `yaml/parse.ts` and `yaml/duplicate-keys.ts`
already pass, for the same reasons.
