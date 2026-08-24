---
id: TASK-84
title: >-
  A schema property type the platform rejects is reported by nothing — the
  converter DOES validate it
status: Done
assignee: []
created_date: '2026-08-22 17:23'
updated_date: '2026-08-24 15:09'
labels:
  - platformos-check
  - mcp-supervisor
  - correctness
  - schema
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
priority: high
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

```yaml
# app/schema/thing.yml
name: thing
properties:
  - name: bogus
    type: not_a_real_type
```

`validate_code` → `{"status":"ok"}`. `pos-cli deploy --dry-run` → accepted. A REAL deploy → **REJECTED**:

```
schema/zz_probe_badtype.yml: Attribute type `not_a_real_type` is not allowed. Valid attribute
types: string, integer, float, decimal, datetime, time, date, binary, boolean, array,
address, file, photo, text, geojson, upload
```

A rejection fails the whole changeset, so this is the same blast radius as the frontmatter shapes.

## Why nothing caught it

`--dry-run` returns before `persist_slice!`, so the nested `CustomAttributeConverter` never runs and the model validation (`custom_attributes/custom_attribute.rb`, `validates :attribute_type, inclusion: { in: VALID_ATTRIBUTE_TYPES }`) is never reached. Every prior measurement of this used the dry run and concluded the converter was permissive.

That conclusion was written into `blocking.ts` as the stated reason `YAMLSyntaxError` is scoped to syntax — "the converter accepts unknown property types and duplicate property names". The first half is now disproved; the comment has been corrected, and the scoping still stands, but on "no shape check exists" rather than "the platform allows it".

## Scope

A check over `app/schema/*.yml` reporting a `type` outside the valid set, at `error`, in `BLOCKING_CHECKS`.

The valid set is a platform constant, not a docset entry. Committing a copy of it here is the antipattern `CLAUDE.md` names — a measurement of the platform that goes stale silently. Decide deliberately where the list comes from and record the reasoning; the error message itself enumerates the set, which is one option.

## Still unmeasured

`duplicate property names` — the other half of the old claim. One real deploy settles it; it is NOT answerable by `--dry-run`.

## Reference

`UPSTREAM-ISSUES-VERIFIED.md` issue 6 and N3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A schema property whose `type` is outside the platform's valid set reports at error, and `validate_code` returns `must_fix_before_write: true`
- [x] #2 Every valid type stays silent, asserted alongside an invalid one in the same test so the silence is not vacuous
- [x] #3 A schema file with no `properties` key, and one whose properties are Liquid-interpolated, report nothing
- [x] #4 Where the valid-type list comes from is a recorded decision, not an unexplained literal
- [x] #5 EMITS and STAYS_SILENT fixtures exist in validate-code.spec.ts, and removing the code from BLOCKING_CHECKS fails a test
- [x] #6 Duplicate property names are measured by a real deploy and the result recorded, whichever way it goes
- [x] #7 A changeset accompanies the change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SUPERSEDED BY TASK-86 — the same defect, filed twice because the two branches could not see each
other's `.backlog/`. TASK-84 was filed on `fix/split-valid-frontmatter-per-shape-checks`; when the
work was actually done on `fix/never-rewrite-operator-expressions`, TASK-84 was not visible there
and TASK-86 was opened for it. Both are now in one tree after merging master.

No work is outstanding. Every acceptance criterion here was satisfied by TASK-86, which shipped in
master as part of `2ca48d4` (#119):

  #1  `InvalidSchemaPropertyType`, severity ERROR, member of `BLOCKING_CHECKS`.
  #2  `accepts every published type, and still reports one that is not` — the valid list is
      DERIVED from the constant so a platform addition cannot fail the test, with a bad entry
      appended as the control.
  #3  no `properties` key, empty sequence, a property with no `type`, and a Liquid-interpolated
      `type` all covered by an `it.each` silence group.
  #4  `SCHEMA_PROPERTY_TYPES` lives in `platformos-common/src/schema-properties.ts`, sourced from
      `CustomAttributes::CustomAttribute::VALID_ATTRIBUTE_TYPES` and confirmed by the deploy error
      that enumerates the set. Pinned as a literal in ONE test so a transcription slip has to
      argue with it, while every other assertion reads the constant.
  #5  EMITS and STAYS_SILENT fixtures are in `validate-code.spec.ts`; the "every blocking check
      can actually block" group drives it end to end.
  #6  THE OPEN MEASUREMENT IS SETTLED: duplicate property names are ACCEPTED by the platform,
      measured on a real deploy. Recorded in `blocking.ts` and in `yaml-syntax-error/index.ts`,
      both of which previously carried the unmeasured claim.
  #7  `.changeset/report-unknown-schema-property-type.md`.

Keep this task rather than archiving it: `UPSTREAM-ISSUES-VERIFIED.md` issue 6 and N3 reference
this number, and a reader arriving from there needs to be told where the work went.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered under TASK-86. See that task for the implementation record; nothing here is outstanding.

The one thing worth carrying forward independently of either task number: this defect existed
because `--dry-run` returns before `persist_slice!`, so the nested `CustomAttributeConverter`
never runs. Every earlier measurement of schema-property behaviour used the dry run and concluded
the converter was permissive — a conclusion that had been written into `blocking.ts` as the stated
REASON `YAMLSyntaxError` is scoped to syntax. A real deploy disproved it. Both the code comment
and the scoping rationale were corrected, and the duplicate-property-name half of the same claim
was measured rather than left standing.
<!-- SECTION:FINAL_SUMMARY:END -->
