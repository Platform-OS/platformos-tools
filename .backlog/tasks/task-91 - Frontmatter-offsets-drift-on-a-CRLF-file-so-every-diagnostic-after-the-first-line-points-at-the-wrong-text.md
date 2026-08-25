---
id: TASK-91
title: >-
  Frontmatter offsets drift on a CRLF file, so every diagnostic after the first
  line points at the wrong text
status: Done
assignee: []
created_date: '2026-08-24 13:07'
updated_date: '2026-08-24 13:26'
labels:
  - platformos-common
  - check-common
  - correctness
  - cross-platform
dependencies: []
references:
  - packages/platformos-common/src/frontmatter/extract.ts
  - packages/platformos-check-common/src/yaml/line-breaks.ts
modified_files:
  - packages/platformos-common/src/yaml-line-breaks.ts
  - packages/platformos-common/src/yaml-line-breaks.spec.ts
  - packages/platformos-common/src/index.ts
  - packages/platformos-common/src/frontmatter/extract.ts
  - packages/platformos-common/src/frontmatter/extract.spec.ts
  - packages/platformos-check-common/src/yaml/line-breaks.spec.ts
  - packages/platformos-check-common/src/yaml/parse.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - .changeset/frontmatter-offsets-survive-crlf.md
priority: high
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`extractFrontmatterBlock` parses `yamlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n')` but reports offsets as `bodyOffset + range`, where `range` is relative to the REWRITTEN string. `\r\n` → `\n` removes a byte per line, so on a CRLF file every offset after the first entry is short by the number of preceding CRLFs.

MEASURED against the built package:

    src = '---\r\nslug: notes\r\nlayout: app\r\n---\r\n<p>hi</p>'

    "slug"   -> source.slice(absStart, absEnd) === "slug"      value === "notes"
    "layout" -> source.slice(absStart, absEnd) === "\nlayou"   value === " ap"

Only the first entry is ever correct. Every frontmatter check reports through these offsets, so on a Windows-authored file `UnknownFrontmatterField`, `InvalidFrontmatterValue`, `MissingLayout`, `MissingFrontmatterAssociation` and `DeprecatedFrontmatterField` all highlight the wrong span — and the further down the block, the further off.

THE NORMALIZATION IS ALSO UNNECESSARY. Measured: `parseDocument` handles `\r\n` natively — for the same body raw vs pre-normalized, the scalar values are identical (`"notes"`, `"app"`, no stray `\r`), `doc.errors` is empty in both, and the ranges from the RAW parse index the raw string correctly. So the CRLF half of that replace buys nothing and costs every offset.

THE LONE-`\r` HALF IS NEEDED AND MUST STAY. Measured: `parseDocument('slug: notes\rlayout: app\r')` reports `Nested mappings are not allowed in compact mappings` and resolves to `{"slug":{"notes\rlayout":"app\r"}}` — a false syntax error, which for frontmatter also suppresses every field rule via `wellFormedFrontmatterBlock`. Psych treats a lone CR as a line break (YAML 1.1) and npm `yaml` does not (YAML 1.2).

That is exactly what `platformos-check-common/src/yaml/line-breaks.ts` already solves, one byte for one byte so offsets are preserved, and its docblock states the rule this code broke: "`\r\n` IS LEFT ALONE. Both specs agree it is a single break, and rewriting it would either change the byte count or leave a stray blank line."

So the fix is to use that function rather than the ad-hoc replace. It lives in check-common and `extract.ts` now lives in platformos-common, which cannot import upward — so `normalizeLoneCarriageReturns` (and its spec) should move to platformos-common beside `yaml-load-options.ts`, with check-common re-exporting it. Copying it instead would create a second answer to a question that already has a documented one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every key and value offset in a frontmatter block indexes the ORIGINAL source correctly on a CRLF file, asserted by slicing the source for EVERY entry in a multi-line block rather than only the first
- [x] #2 The same assertions hold for LF and for a lone-CR file, so the fix is not specialised to one line ending
- [x] #3 A lone carriage return still does not produce a syntax error and still does not suppress the field rules — with a control asserting a genuinely malformed block still does both
- [x] #4 Reintroducing the CRLF replace makes the CRLF offset tests fail, and removing the lone-CR normalization makes the lone-CR test fail
- [x] #5 Full suites pass for platformos-common, platformos-check-common, platformos-check-node, platformos-mcp-supervisor, platformos-language-server-common and platformos-graph, plus type-check and format:check
- [x] #6 A changeset accompanies the change
- [x] #7 normalizeLoneCarriageReturns has ONE definition in the monorepo, in platformos-common; check-common's yaml/parse.ts and yaml/duplicate-keys.ts import it from there, no shim file and no inline respelling of the same regex
- [x] #8 line-breaks.spec.ts splits along its existing seam: the `Unit:` describe travels to platformos-common with the function, the `Integration:` describe stays in check-common because it exercises toYAMLNode/YAMLConvertError/getPosition, which live there
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the function to `platformos-common/src/yaml-line-breaks.ts`, beside `yaml-load-options.ts` (flat file, matching its sibling — not a new directory, which would churn an existing export path for no gain). Export from the root barrel.
2. Move the `Unit:` describe to `platformos-common/src/yaml-line-breaks.spec.ts`, verbatim apart from the import.
3. Delete `check-common/src/yaml/line-breaks.ts`; point `yaml/parse.ts` and `yaml/duplicate-keys.ts` at `@platformos/platformos-common`. Leave `yaml/line-breaks.spec.ts` holding only its `Integration:` describe.
4. `frontmatter/extract.ts`: replace `.replace(/\r\n/g,'\n').replace(/\r/g,'\n')` with `normalizeLoneCarriageReturns(yamlBody)`.
5. Tests: for LF, CRLF and lone-CR spellings of the SAME block, every key and every value slices back out of the ORIGINAL source, and every value is free of stray CR. Not just the first entry — the drift only appears from the second onwards.
6. Sabotage both directions: reintroduce the CRLF replace (offset tests must fail); drop the lone-CR normalization (the stray-CR value test must fail).
7. Clean rebuild (`rm -rf dist` — a moved file leaves a stale output), full suites, type-check, format:check, changeset. No commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
THE PLAN'S "lone CR" TEST ROW WAS TESTING SOMETHING THAT DOES NOT EXIST, and finding that out
changed the shape of the spec.

A file whose every line ends with a bare CR has NO frontmatter — not on our side, and not on the
platform's. Measured by running the platform's own `LIQUID_CONFIG_REGEX` against the four
spellings under Ruby:

    LF                 MATCHED  -> {"slug" => "notes", "layout" => "app"}
    CRLF               MATCHED  -> {"slug" => "notes", "layout" => "app"}
    pure CR            NO FRONTMATTER (whole file is body)
    LF with stray CR   MATCHED  -> {"slug" => "notes", "layout" => "app"}

The regex closes the block on `\n\s*---`, so with no `\n` anywhere it cannot match. Our scan
reaches the same answer independently, by finding no `\n` to look for.

So the third parameterised row became `LF with a stray CR` — the paste artefact `line-breaks.ts`
was written for, and a case that IS reachable — and the pure-CR behaviour got its own test
pinning the agreement, with an LF control so the silence is attributable to the line endings
rather than to an unreadable fixture. It was previously accidental, and someone teaching the scan
to understand CR would have silently started reading frontmatter the platform never reads.

NOTE ON THE CRLF/Psych AGREEMENT: Psych returns `"app"` for the CRLF fixture, with no trailing
`\r`. After this change so do we. That was worth measuring rather than assuming, because it is
the whole justification for deleting the CRLF pass.

THE SPEC SPLIT ALONG A SEAM THAT WAS ALREADY THERE. `line-breaks.spec.ts` held a `Unit:` describe
(pure, no check-common imports) and an `Integration:` describe built on `toYAMLNode`,
`YAMLConvertError` and `getPosition`. Only the first could travel; the second stays and keeps the
offset-preservation proof for check-common's own parser.

A stale comment in `yaml/parse.ts` pointing at `line-breaks.ts` was updated to name the new
location — it is the file a reader is sent to for the one-byte-for-one-byte argument.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`extractFrontmatterBlock` now normalizes only a LONE `\r`, via `normalizeLoneCarriageReturns`,
instead of collapsing `\r\n` to `\n` first. The collapse shortened the string it parsed while
offsets were reported into the original file, so on a CRLF file every entry after the first
pointed a byte further left per preceding line — and every frontmatter check reports through
those offsets.

Two measurements justified deleting the CRLF pass rather than compensating for it. `parseDocument`
reads `\r\n` natively and yields clean scalars for block, folded and quoted forms alike, so the
pass bought nothing. And the lone-`\r` pass is load-bearing beyond classic-Mac files: the
extracted body ends at the newline before the closing fence, so on ANY CRLF file its last byte is
a lone `\r` — measured to produce `{"layout":"app\r"}` without it.

`normalizeLoneCarriageReturns` moved to platformos-common (`yaml-line-breaks.ts`, beside
`yaml-load-options.ts`), with its `Unit:` describe. check-common's `yaml/parse.ts` and
`yaml/duplicate-keys.ts` import it from there; no shim file, no second copy — verified by grepping
every package for a hand-rolled CR replace.

TESTS: the same three-key block in LF, CRLF and stray-CR spellings, each asserting that EVERY key
and EVERY value slices back out of the original source, that the parse is clean, and that no value
carries a stray CR. Every entry rather than the first, because a one-key fixture passes with the
bug fully present. Plus the pure-CR block, pinned as having no frontmatter, with an LF control.

SABOTAGE, both directions: reintroducing the CRLF collapse fails the offset test; dropping the
lone-CR pass fails 4 tests — including the CRLF rows, which is the trailing-`\r` prediction
confirming itself.

Verification: common 583 (574 + 3 moved + 7 new − 1 replaced), check-common 1753 (1756 − the 3
that left), graph 113, check-node 195, supervisor 487, language-server 595. Type-check and
format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
