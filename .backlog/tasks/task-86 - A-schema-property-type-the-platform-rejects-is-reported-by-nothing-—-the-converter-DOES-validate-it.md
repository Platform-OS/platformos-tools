---
id: TASK-86
title: >-
  A schema property type the platform rejects is reported by nothing — the
  converter DOES validate it
status: Done
assignee: []
created_date: '2026-08-22 19:37'
updated_date: '2026-08-22 19:38'
labels:
  - platformos-check
  - platformos-common
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
properties:
  - name: bogus
    type: not_a_real_type
```

`validate_code` answered `status: ok`, and `pos-cli deploy --dry-run` accepted it. A REAL deploy rejects it: `Attribute type 'not_a_real_type' is not allowed. Valid attribute types: string, integer, float, decimal, datetime, time, date, binary, boolean, array, address, file, photo, text, geojson, upload` — and a rejection fails the whole changeset.

## Why nothing caught it

`--dry-run` returns before `persist_slice!`, so the nested `CustomAttributeConverter` that validates the type never runs. Every prior measurement used the dry run and concluded the converter was permissive. That conclusion was recorded as evidence in three places: `blocking.ts`'s reason for scoping `YAMLSyntaxError` to syntax, `YAMLSyntaxError`'s own docblock, and the MCP server's instructions to agents.

## Reference

`UPSTREAM-ISSUES-VERIFIED.md` issue 6 and N3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A schema property whose type is outside the platform's set reports at error, and validate_code returns must_fix_before_write true
- [x] #2 A valid type in the wrong case reports, matching the platform's case-sensitive inclusion
- [x] #3 Every published type stays silent, paired in the same test with an invalid one so the silence is not vacuous
- [x] #4 The published type list is pinned by a literal, so a corrupted transcription cannot move the tests with it
- [x] #5 A YAML file whose properties are not converted stays silent, with a control proving the identical document reports where the converter does run
- [x] #6 A schema with no properties, an empty sequence, a property with no type, and a Liquid-interpolated type all stay silent
- [x] #7 An unparseable document is left to YAMLSyntaxError
- [x] #8 The three places recording that the platform accepts unknown property types are corrected, including the server instructions
- [x] #9 Sabotage-verified: case-insensitivity, a removed file-type guard, a corrupted type list, and removal from BLOCKING_CHECKS each fail a test
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`InvalidSchemaPropertyType` reports a property type the platform rejects — error, blocking — across all four file types whose `properties:` are converted by `CustomAttributeConverter` (`schema/`, `transactable_types/`, `instance_profile_types/`, `user.yml`), confirmed on the instance for a table and for `user.yml`.

Nine real deploys, because `--dry-run` cannot answer here. Beyond the type itself they settled five things that were open or wrong:

| Case | Deploy |
|---|---|
| `type: String` (valid type, wrong case) | rejected — the model's `inclusion:` is literal |
| unknown top-level key | rejected — `Available properties are: metadata, name, properties` |
| unknown property-level key | rejected |
| duplicate property names | **accepted** |
| `properties:` as a mapping | rejected — `no implicit conversion of String into Integer` |

The mapping form was measured with both a valid and an invalid type, so it is the shape and not the type — which makes `schema-table.ts`'s own docblock example invalid. Corrected.

**Three recorded false premises fixed.** `blocking.ts`, `YAMLSyntaxError`'s docblock and the MCP server's agent instructions all said the platform accepts unknown property types. They said it because the measurement behind them was a dry run, which returns before the nested converter. What survives is the true, narrower claim: schema-SHAPE validation is scoped out because no check covers it, not because the platform is permissive.

**Two sabotages initially did NOT bite, and both were real test defects.** The file-type guard survived because the translation fixture nested `properties` under a locale key, so nothing was found either way — vacuous. And a corrupted type list survived because every assertion derived from the constant, moving the tests with it. Fixed by putting `properties` at the root with an on-schema control, and by pinning the list as a literal. Both bite now, alongside case-insensitivity and removal from `BLOCKING_CHECKS`.

A `deploy` provenance oracle was added to the supervisor's silence fixtures: labelling this evidence `dry-run` would have been false, since the dry run accepts the shapes at issue.

Found in passing, third of its kind: the sweep project's `invalid_schema.yml` carries a field named `bad_type_field` with `type: nonexistent_type`, authored to be caught and never reported.

Verification: common 559, check-common 1769, check-node 195, supervisor 473, language-server 595. Type-check and Prettier clean; factory configs regenerated.
<!-- SECTION:FINAL_SUMMARY:END -->
