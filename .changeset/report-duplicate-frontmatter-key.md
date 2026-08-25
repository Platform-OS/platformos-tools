---
'@platformos/platformos-check-common': minor
'@platformos/platformos-common': patch
---

Add `DuplicateFrontmatterKey`, which reports a frontmatter key whose value is silently discarded

A key written twice in frontmatter is legal input — the platform parses it with Psych, which has
no uniqueness rule, and keeps the last value. Measured by syncing a page declaring `slug` twice:
it synced without error, the first slug 404s and the second serves.

That is exactly why it is worth reporting. The file deploys and works, and the earlier value is
gone with nothing to say so. The same defect in a `.yml` file has been reported by
`DuplicateYAMLKey` since it landed; that check is `SourceCodeType.YAML` and never sees a
`.liquid` file, which left frontmatter uncovered — the same gap `InvalidFrontmatterSyntax` fills
for `YAMLSyntaxError`.

It is a WARNING and does not block, because the platform accepts the file. The reported range
covers the DISCARDED entry rather than the surviving one, so the author is pointed at the line
that does nothing instead of the value they still have.

Key identity comes from the existing `findDuplicateKeys`, which reconciles npm `yaml` (YAML 1.2)
with Psych (YAML 1.1) against an oracle generated from a live Ruby: `yes:` and `true:` are ONE key
to the platform, while `1:` and `1.0:` are TWO. Nothing about that is re-derived here.

`FrontmatterBlock` gains a `body` field — the YAML body exactly as it appears in the file — for
consumers that need to run their own parse over the block and place its offsets.
