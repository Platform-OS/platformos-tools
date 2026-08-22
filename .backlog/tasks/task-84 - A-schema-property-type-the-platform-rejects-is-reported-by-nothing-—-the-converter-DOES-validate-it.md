---
id: TASK-84
title: >-
  A schema property type the platform rejects is reported by nothing — the
  converter DOES validate it
status: To Do
assignee: []
created_date: '2026-08-22 17:23'
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
- [ ] #1 A schema property whose `type` is outside the platform's valid set reports at error, and `validate_code` returns `must_fix_before_write: true`
- [ ] #2 Every valid type stays silent, asserted alongside an invalid one in the same test so the silence is not vacuous
- [ ] #3 A schema file with no `properties` key, and one whose properties are Liquid-interpolated, report nothing
- [ ] #4 Where the valid-type list comes from is a recorded decision, not an unexplained literal
- [ ] #5 EMITS and STAYS_SILENT fixtures exist in validate-code.spec.ts, and removing the code from BLOCKING_CHECKS fails a test
- [ ] #6 Duplicate property names are measured by a real deploy and the result recorded, whichever way it goes
- [ ] #7 A changeset accompanies the change
<!-- AC:END -->
