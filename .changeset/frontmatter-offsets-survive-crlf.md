---
'@platformos/platformos-common': patch
'@platformos/platformos-check-common': patch
---

Fix frontmatter diagnostics pointing at the wrong text in a file with CRLF line endings

`extractFrontmatterBlock` parsed a copy of the frontmatter body with `\r\n` collapsed to `\n`,
but reported offsets into the ORIGINAL file. Collapsing removes a byte per line, so every entry
after the first was short by the number of preceding CRLFs, and the drift grew down the block:

    '---\r\nslug: notes\r\nlayout: app\r\n---\r\n'
      slug   → "slug"      ✓
      layout → "\nlayou"   value → " ap"

Every frontmatter check reports through those offsets, so on a Windows-authored file
`UnknownFrontmatterField`, `InvalidFrontmatterValue`, `MissingLayout`,
`MissingFrontmatterAssociation` and `DeprecatedFrontmatterField` all highlighted the wrong span.

The collapse was also unnecessary: `parseDocument` reads `\r\n` natively and yields scalars with
no stray `\r`, block and quoted alike. Only a LONE `\r` needs rewriting — the platform's Psych
(YAML 1.1) treats it as a line break and npm `yaml` (YAML 1.2) does not — and that substitution
is one byte for one byte, so offsets survive it. It matters for more than classic-Mac files: the
extracted body ends at the newline before the closing fence, so on any CRLF file its last byte is
a lone `\r` that would otherwise ride into the final entry's value.

`normalizeLoneCarriageReturns` moves from `platformos-check-common` to `platformos-common` so both
sides share one definition; check-common's `yaml/parse.ts` and `yaml/duplicate-keys.ts` import it
from there and are otherwise unchanged.
