---
id: TASK-87
title: >-
  An unrecognised key in a schema file is a deploy rejection that nothing
  reports
status: To Do
assignee: []
created_date: '2026-08-22 19:38'
labels:
  - platformos-check
  - correctness
  - schema
dependencies: []
references:
  - UPSTREAM-ISSUES-VERIFIED.md
priority: medium
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Two shapes, both measured by a REAL deploy (`--dry-run` accepts both — it returns before the converter that raises):

```yaml
# app/schema/thing.yml — unknown TOP-LEVEL key
name: thing
bogus_top_level_key: 1
properties:
  - name: title
    type: string
```
→ `Unknown properties: bogus_top_level_key. Available properties are: metadata, name, properties.`

```yaml
# unknown PROPERTY-LEVEL key
properties:
  - name: title
    type: string
    bogus_property_key: 1
```
→ `Error while creating Property with name: title ... unknown attribute 'bogus_property_key' for CustomAttributes::CustomAttribute.`

Both fail the whole changeset. Nothing reports either.

## Why this was split out of TASK-86

TASK-86 shipped the property `type` check. These were found by the same probes but need a different input: a list of valid KEYS rather than a list of valid values.

- **Top-level** is tractable: the rejection enumerates the set (`metadata, name, properties`), and `custom_attributes` is accepted as the deprecated alias for `properties` — all four confirmed on the instance. The lists differ per converter, though, and only `CustomModelType`'s has been measured.
- **Property-level is NOT tractable the same way.** The valid set is a Rails model's attribute list (`CustomAttributes::CustomAttribute`), which is large, undocumented and unstable. Transcribing it would be a committed measurement that goes stale silently AND produces false blocks on valid code when wrong. Do not attempt it without a reliable source.

## Also open

`properties:` given as a mapping rather than a sequence is rejected (`no implicit conversion of String into Integer`) — measured with both a valid and an invalid type, so it is the shape. Unreported, and the error is opaque enough that a check would be worth real money.

## Reference

`UPSTREAM-ISSUES-VERIFIED.md` issue 6; TASK-86 for the measurements and the corrected premises.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An unrecognised top-level key in a schema file reports and blocks, for the converter whose key set has been measured
- [ ] #2 Every valid top-level key stays silent — name, properties, custom_attributes, metadata — paired with an unrecognised one in the same test
- [ ] #3 Where the valid-key set comes from is recorded, and any converter whose set is unmeasured is left unchecked rather than guessed at
- [ ] #4 A decision is recorded on property-level keys: either a reliable source for the attribute list is found, or the case is documented as deliberately unchecked
- [ ] #5 A mapping-shaped properties value is either reported or explicitly recorded as out of scope
- [ ] #6 Sabotage-verified, and a changeset accompanies the change
<!-- AC:END -->
