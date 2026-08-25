---
id: TASK-83.1
title: >-
  Split ValidFrontmatter into per-shape check codes and block the deploy-fatal
  ones
status: Done
assignee: []
created_date: '2026-08-22 16:31'
updated_date: '2026-08-22 17:02'
labels:
  - platformos-check
  - mcp-supervisor
  - frontmatter
  - breaking
dependencies: []
parent_task_id: TASK-83
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Scope

Replace the single `ValidFrontmatter` code with one code per rule, so the write gate can admit the deploy-fatal shapes without also admitting the advisory ones. Detection logic is unchanged in this subtask — the shapes reported today report identically, under new codes and new severities. New detection lands in the sibling subtasks.

## Codes

| New code | Reports | Severity | In `BLOCKING_CHECKS` |
|---|---|---|---|
| `UnknownFrontmatterField` | a key absent from the file type's schema | error | yes |
| `InvalidFrontmatterValue` | enum mismatch, and `layout: false` | error | yes |
| `MissingLayout` | `layout:` / `layout_name:` naming a layout that does not exist | error | yes |
| `MissingFrontmatterAssociation` | `authorization_policies` and the FormConfiguration notification arrays | warning | no |
| `DeprecatedFrontmatterField` | deprecated keys, and the `home.liquid` alias | warning | no |

`MissingLayout` joins the existing `MissingPage` / `MissingPartial` / `MissingAsset` naming family.

`MissingFrontmatterAssociation` is NOT blocking: `--dry-run` accepts it, but `--dry-run` returns before `bulk_write_associations_from_snapshot!`, which is where `base_converter.rb:497` `raise_missing_association_error` lives, so its deploy behaviour is unmeasured. The gate does not block on uncertainty. TASK-83 carries the follow-up that settles it.

## Blocking-set requirements

`packages/platformos-mcp-supervisor/src/result/blocking.ts` gains the three fatal codes, each with the WHY the file's membership rule demands. `validate-code.spec.ts` requires, per member, an emission fixture (`EMITS`) and a must-stay-silent fixture (`STAYS_SILENT`); both lists are pinned against `BLOCKING_CHECKS`, so a member without a fixture fails the suite.

The stale `ValidFrontmatter` note in the NOT-in-the-set docblock is removed, and its reasoning corrected where it survives: it claims three findings and one unavoidable false block, when there are seven reachable shapes and `layout: false` — the finding it named as harmless — is itself a converter rejection.

## Registration

`src/checks/index.ts`, then regenerate the factory configs (`node packages/platformos-check-node/scripts/generate-factory-configs.js`) or `all.yml` / `recommended.yml` will not list the new codes.

## Compatibility

Hard split, no alias. A `.platformos-check.yml` naming `ValidFrontmatter` stops matching; the changeset names the replacements.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ValidFrontmatter` no longer exists in `allChecks`, and the five replacement codes are registered and present in the regenerated `all.yml` and `recommended.yml`
- [x] #2 Each shape reports under its new code at its new severity, with the message and position unchanged from before the split
- [x] #3 `validate_code` returns `must_fix_before_write: true` for an unknown field, a missing layout and `layout: false`
- [x] #4 `validate_code` returns `must_fix_before_write: false` for a deprecated field, a deprecated `home.liquid` and a missing authorization policy, each paired with an assertion that the finding IS still reported so the silence is not vacuous
- [x] #5 `blocking.ts` names each new blocking member with the measured reason it blocks, and the stale ValidFrontmatter reasoning is gone
- [x] #6 `validate-code.spec.ts` has an EMITS fixture and a STAYS_SILENT fixture for each newly blocking code
- [x] #7 Deliberately removing one new code from BLOCKING_CHECKS makes a test fail, and deliberately reclassifying `DeprecatedFrontmatterField` as blocking also makes a test fail (sabotage-verified)
- [x] #8 A changeset records the split and names the replacement codes for anyone whose config referenced ValidFrontmatter
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Sequenced as refactor-then-split

The extraction was pulled into `src/frontmatter/extract.ts` FIRST, with the old check rewired onto it and its 75-test spec passing untouched. That proved the extraction was faithful before any code changed, so the split's own failures could only be about codes and severities.

The 702-line suite then moved to `src/frontmatter/frontmatter-checks.spec.ts` with only the check LIST changed — same fixtures, same assertions, same messages. 84 of its 86 assertions passed on the first run; the two that failed were the `layout: false` message, corrected deliberately (see below). That suite is the behaviour-preservation proof and is documented as such.

## The shared extractor is memoised, and that was measured

Five checks reading one block would have parsed it five times. `parseDocument` costs **~80 µs** on a representative block — ~640 ms of redundant parsing over a 2 000-page project. Control: `trimStart().length` on the same string is 0.04 µs, so the number is the parse and not the harness.

`check()` iterates file-major, but its per-check pipelines are promises awaited together, so execution can interleave across files — which rules out the size-1 `createBoundedCache` that `graphql-schema.ts` uses for the one SDL. A `WeakMap` keyed on the file object is order-independent. It is guarded by the source string because an `AppFile` object is reused when a buffer is re-read, so identity alone would serve the language server a stale block after every keystroke. Both halves are sabotage-tested.

## TASK-83.5 folded in

Writing `InvalidFrontmatterValue` meant writing its `layout: false` diagnostic, and the existing wording ("falls back to the default layout") was measured false. Shipping a NEW check carrying a message known to be wrong is not a defensible increment, so 83.5 landed here. Its two pinned assertions were updated and no occurrence of the old wording survives in the repository.

## Dead rule removed rather than carried across

`Missing required frontmatter field` cannot fire — no schema sets `required: true`. Carrying it into a sixth code would have created a check that can never report, which then needs a permanent exemption from the supervisor's "every blocking check can actually block" fixtures. Removed, and recorded in the changeset. Measured separately: an ApiCall missing `request_type` is ACCEPTED by the converter, so even a live version would not have been blocking.

## Sabotage results

| Sabotage | Result |
|---|---|
| A — `MissingLayout` dropped from `BLOCKING_CHECKS` | 6 failed |
| B — `DeprecatedFrontmatterField` wrongly added to it | 4 failed |
| C — `InvalidFrontmatterValue` severity downgraded to warning | 2 failed |
| D — `layout: false` no longer handled (shape lands under wrong code) | 3 failed |
| E — home-alias deprecation silently dropped | 4 failed |
| F — extractor memo removed | 1 failed |
| G — extractor source guard removed (stale-cache) | 1 failed |
| restored | all green |

## Verification

- `platformos-check-common` 1743 passed (103 files)
- `platformos-mcp-supervisor` 481 passed (21 files)
- `platformos-check-node` 195 passed (18 files)
- `platformos-language-server-common` 595 passed (67 files)
- `yarn type-check` across the monorepo: clean; Prettier: clean
- Factory configs regenerated (the generator reads `dist`, so check-common must be built first — otherwise it silently re-emits the old list)

End to end through a fresh `pos-cli check run`:

```
app/views/pages/assoc.liquid          ⚠  MissingFrontmatterAssociation
app/views/pages/bad_layout.liquid     ✖  MissingLayout
app/views/pages/deprecated.liquid     ⚠  DeprecatedFrontmatterField
app/views/pages/layout_false.liquid   ✖  InvalidFrontmatterValue
app/views/pages/unknown_key.liquid    ✖  UnknownFrontmatterField
good.liquid                              (silent — control)
5 offenses in 5 files   ✖ 3 errors  ⚠ 2 warnings
```

## Follow-ups this creates

- Five documentation pages needed in `platformos-documentation`; `valid-frontmatter`'s page retires. `check-docs.spec.ts` enforces the URL shape, not the page's existence, so the suite stays green while the pages are written.
- A long-lived MCP supervisor process must be restarted after this change: it holds the old check registry in memory while reading the regenerated config from disk, so no frontmatter check matches and the gate silently reports nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`ValidFrontmatter` is replaced by five per-shape codes, and the three the converter rejects now block a write.

`UnknownFrontmatterField`, `InvalidFrontmatterValue` and `MissingLayout` are errors and members of the supervisor's `BLOCKING_CHECKS`, each carrying the measured converter error that justifies it. `DeprecatedFrontmatterField` and `MissingFrontmatterAssociation` stay warnings and stay out of the set — for different reasons, recorded separately: the first is measured to deploy cleanly, the second is UNMEASURED because `--dry-run` returns before the association write, and the gate does not block on its own uncertainty.

All five read one block through a new memoised extractor (`src/frontmatter/extract.ts`), justified by measurement rather than taste.

This is the discriminator TASK-26 was blocked on, and it needed no `Offense.data` seam: TASK-8.1 answers "which symbol", the gate needs "which rule", and one-rule-one-code is already the house style (doc-params are five codes, filters four). TASK-26's recorded blocker rested on two wrong facts — seven reachable shapes rather than three, and `layout: false`, named there as harmless, is itself a converter rejection.

Behaviour preservation is proved by the inherited 702-line suite, which moved with only its check list changed. Seven sabotages each break the suite.
<!-- SECTION:FINAL_SUMMARY:END -->
