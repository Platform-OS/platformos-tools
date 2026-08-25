---
id: TASK-92
title: A duplicate frontmatter key silently discards a value and nothing reports it
status: Done
assignee: []
created_date: '2026-08-24 13:07'
updated_date: '2026-08-24 13:49'
labels:
  - check-common
  - coverage-gap
  - yaml-dialect
dependencies:
  - TASK-91
references:
  - packages/platformos-check-common/src/checks/duplicate-yaml-key/index.ts
  - packages/platformos-check-common/src/yaml/duplicate-keys.ts
  - packages/platformos-check-common/src/yaml/psych-key-identity.ts
  - packages/platformos-common/src/frontmatter/extract.ts
modified_files:
  - >-
    packages/platformos-check-common/src/checks/duplicate-frontmatter-key/index.ts
  - >-
    packages/platformos-check-common/src/checks/duplicate-frontmatter-key/index.spec.ts
  - packages/platformos-check-common/src/checks/index.ts
  - packages/platformos-check-node/configs/all.yml
  - packages/platformos-check-node/configs/recommended.yml
  - packages/platformos-common/src/frontmatter/extract.ts
  - packages/platformos-mcp-supervisor/src/result/blocking.spec.ts
  - packages/platformos-mcp-supervisor/src/transport/validate-code.spec.ts
  - .changeset/report-duplicate-frontmatter-key.md
priority: medium
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-90 established, by syncing a page whose `slug` was declared twice, that the platform ACCEPTS a repeated frontmatter key and resolves it LAST-WINS. It therefore stopped reporting the duplicate as a syntax error, which was a false positive that also suppressed every field rule in the block.

WHAT THAT LEAVES: nothing reports the duplicate at all. The earlier value is silently discarded and the author never learns.

THE SAME DEFECT IN A `.yml` FILE IS ALREADY REPORTED, by `DuplicateYAMLKey`, whose docblock makes exactly this argument: "this is silent DATA LOSS, not a style preference, and nothing else in the system will ever say so." That check is `SourceCodeType.YAML`, so it never sees a `.liquid` file — the identical structural gap that `InvalidFrontmatterSyntax` exists to fill for `YAMLSyntaxError`. The pairing to mirror is:

    YAMLSyntaxError (YAML)  <->  InvalidFrontmatterSyntax (Liquid)
    DuplicateYAMLKey (YAML) <->  this check              (Liquid)

REUSE, DO NOT REIMPLEMENT. `findDuplicateKeys(source)` in `check-common/src/yaml/duplicate-keys.ts` already answers this, and its hard part is not the traversal: it reconciles npm `yaml` (1.2) with Psych (1.1) over KEY IDENTITY, backed by `psych-key-identity.ts`, which is generated from a live Ruby. `1:` and `1.0:` are two keys to Ruby and one number to JS; `yes:` and `true:` are one key to Psych. Re-deriving any of that would be a false-positive generator.

SEVERITY IS SETTLED BY PRECEDENT, not by fresh judgement: `DuplicateYAMLKey` is a WARNING and must never block, because the platform accepts the file. The same reasoning applies unchanged here. It must not join `BLOCKING_CHECKS`.

THE RANGE IS THE DISCARDED ENTRY, following `DuplicateYAMLKey` — the later occurrence is the one that WINS, so anchoring there would point the author at the working value and invite them to delete it.

DEPENDS ON TASK-91. `findDuplicateKeys` returns offsets relative to the string it is given, and the caller must add `bodyOffset` to place them in the `.liquid` file. Today that arithmetic is wrong on any CRLF file because `extractFrontmatterBlock` parses a length-changed copy of the body. Building this on those offsets would ship a check that highlights the wrong line for every Windows author.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A key declared twice in a frontmatter block is reported once, at severity warning, naming the key and the line of the occurrence that wins
- [x] #2 The reported range covers the DISCARDED entry, not the surviving one, asserted by slicing the source
- [x] #3 The check is absent from BLOCKING_CHECKS and must_fix_before_write stays false for a buffer whose only finding is this one
- [x] #4 Key identity comes from findDuplicateKeys rather than any new comparison, so the Psych-vs-npm-yaml reconciliation is not re-derived — asserted by a case where the two dialects disagree (`yes:`/`true:` as one key, `1:`/`1.0:` as two)
- [x] #5 Offsets are correct on a CRLF file as well as an LF one, for a duplicate that is not on the first line
- [x] #6 A block with no duplicate reports nothing, and a block with a duplicate STILL reports its other field findings — both asserted, so neither half is vacuous
- [x] #7 The check is registered in src/checks/index.ts and the factory configs are regenerated so all.yml and recommended.yml list it
- [x] #8 Deliberately breaking the duplicate detection makes its tests fail, and widening it to fire on every key makes the no-duplicate test fail
- [x] #9 A documentation page for the new check code exists upstream in platformos-documentation, or its absence is recorded on this task with the reason
- [x] #10 A changeset accompanies the change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#9 — DOCUMENTATION PAGE DOES NOT EXIST YET, recorded here as the AC allows. The check's
`docs.url` points at
`https://documentation.platformos.com/developer-guide/platformos-check/checks/duplicate-frontmatter-key`,
which must be authored in the `platformos-documentation` repository. That is the same outstanding
item as the six frontmatter codes from TASK-83.x and `InvalidSchemaPropertyType` from TASK-86; no
suite here depends on it.

ONE EXPECTATION OF MINE WAS WRONG, and the code was right. I asserted the `yes:`/`true:` case
would name the key `'yes'` (the source spelling of the discarded line). It names `'true'`, because
`findDuplicateKeys` reports the RESOLVED YAML 1.1 key — verified directly against the shared
function, and `DuplicateYAMLKey` has behaved this way since it landed. I corrected the test rather
than the behaviour: changing it would have altered the sibling check too, on my preference rather
than on evidence. The test now asserts the message AND the range together, so the thing that
actually tells the author where to look is pinned beside the slightly surprising name.

THE SEAM ADDED TO `FrontmatterBlock` is `body`. `findDuplicateKeys` needs to run its own YAML 1.1
parse over the block, and it takes a string; without exposing the body the check would have had to
re-derive the delimiter scan, which is the duplication this whole cluster has been removing. The
field is the raw, unnormalized body, so offsets from any such parse are placed by `bodyOffset` —
which only became reliable in TASK-91.

THE `instructions.ts` QUESTION WAS CHECKED AND NEEDS NOTHING. `coverage()` is derived
(`allChecks.length`), so the count moves on its own, and the instructions make no claim about
frontmatter or duplicate keys — so this change introduces no stale assertion there. An
`instructions-coverage.spec.ts` entry would have pinned a claim that does not exist; the
behavioural proof went into `validate-code.spec.ts` instead, beside the `DuplicateYAMLKey` case it
mirrors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`DuplicateFrontmatterKey` reports a frontmatter key whose earlier value the platform silently
discards — the Liquid-side sibling of `DuplicateYAMLKey`, closing the same structural gap that
`InvalidFrontmatterSyntax` closes for `YAMLSyntaxError`.

It adds no judgement of its own. Severity, non-blocking status and the decision to anchor the
range on the DISCARDED entry are all inherited from `DuplicateYAMLKey`'s already-argued reasoning:
the platform accepts the file, so it cannot block; the later occurrence is the one that wins, so
pointing there would invite the author to delete the value they still have.

Key identity is `findDuplicateKeys`, unchanged — the npm `yaml` (1.2) vs Psych (1.1)
reconciliation backed by a Ruby-generated oracle. Two tests pin it from OPPOSITE directions, so
any locally-grown comparison fails one of them: `yes:`/`true:` must be ONE key, `1:`/`1.0:` must
be TWO.

Offsets are placed by `block.bodyOffset`, which TASK-91 made trustworthy; the LF/CRLF pair asserts
the range by slicing it back out of the source, for a duplicate deliberately below the first line,
where the old drift would have shown.

Registered in `src/checks/index.ts` with the factory configs regenerated (`severity: 1`, warning,
in both `all.yml` and `recommended.yml`). Verified absent from `BLOCKING_CHECKS`, with the gate
asserted twice: as a unit in `blocking.spec.ts`, and end to end through the MCP server in
`validate-code.spec.ts`, where the buffer comes back `must_fix_before_write: false` with the
finding present in `warnings` — silence and non-blocking are different claims and only the second
is the promise.

SABOTAGE, both directions required: detection that never fires breaks 7 tests; detection widened
to every key breaks 9, including the silence cases, which is the direction a too-eager check would
take.

Verification: common 583, check-common 1766 (1753 + 13), supervisor 489 (487 + 2), check-node 195,
graph 113, language-server 595. Type-check and format:check clean.
<!-- SECTION:FINAL_SUMMARY:END -->
