---
id: TASK-111
title: >-
  A GraphQL query naming a table no schema declares is reported by nothing, at
  any layer
status: To Do
assignee: []
created_date: '2026-09-07 18:03'
labels:
  - check-common
  - false-approval
  - measured
dependencies:
  - TASK-110
priority: medium
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A `.graphql` file that filters on a table which does not exist is invisible at EVERY layer. Not a parse error, not a schema error, not a deploy rejection, no runtime error, and no log row — a typo'd table is indistinguishable from an empty table.

MEASURED on a live instance:

```liquid
{% graphql g %}
{ records(per_page: 1, filter: { table: { value: "no_such_table_xyz" } }) { total_entries results { id } } }
{% endgraphql %}
```

renders `{"records":{"total_entries":0,"results":[]}}` — success, zero rows. `validate_code` reports nothing.

## Why the existing checks cannot cover it

`RecordsFilterInput.table` is a **`StringFilter`**, not an enum — confirmed by live introspection. So `GraphQLCheck`, which validates the document against the published schema, is structurally incapable of rejecting any table value however good the docset becomes. Only a PROJECT-AWARE check can, because the valid set is whatever the project's schema files declare.

## Why it is feasible — the risk that could have killed it is refuted

There are **no platform-provided tables**. `admin_tables` on a live instance returned 5 rows, every one created by a schema deployed during earlier probing. A table exists only because a schema file created it, so the check needs no allowlist of built-in names — the project's own schema files are the complete vocabulary.

## What already exists

- `extractGraphqlTables` and `extractSchemaTable` in `platformos-common`, documented as siblings "so a consumer can join a GraphQL operation to the schema it targets".
- The graph already records BOTH halves: `module.tables` (`traverse.ts:94`) and `module.table` (`:102`), with `types.ts:161` describing them as something "a consumer can join against".
- Nothing performs the join. That is the whole of the missing work, once TASK-110 makes the extractor trustworthy.

Structurally this is `MissingPartial` for tables: a reference whose target does not exist.

## Blocked on TASK-110

The extractor currently misses four mutations that pass `table` as a direct argument, and returns `remote_records` tables that live on another instance. Building this check on top of it would both under-report and produce a false positive on every remote query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A `.graphql` file naming a table that no schema file declares is reported — joining `extractGraphqlTables` against every schema's `extractSchemaTable` name
- [ ] #2 NON-BLOCKING. Measured: the file deploys and renders `{"records":{"total_entries":0,"results":[]}}`, so it fails the `BLOCKING_CHECKS` bar (not a parse failure, not a runtime raise, not a converter rejection). Severity error, membership of BLOCKING_CHECKS withheld
- [ ] #3 CONTROL: a table declared by a MODULE schema is not reported — `PlatformOSFileType.Table` covers `schema`, `custom_model_types` and `model_schemas` under module paths as well as app paths
- [ ] #4 CONTROL: a dynamic (non-string) table is not reported
- [ ] #5 CONTROL: a `remote_records` table is not reported — depends on TASK-110
- [ ] #6 MEASURE FIRST, do not assume: what happens when a table is declared by a module that is NOT in the local checkout. Same class as MissingPartial's absent-target problem; if it produces false positives the check needs the same treatment or must not ship
- [ ] #7 Registered in `src/checks/index.ts` AND the factory configs regenerated, or `all.yml` / `recommended.yml` will not list it
- [ ] #8 Swept over several real projects with the offense count recorded, so a wide false-positive source shows up before release rather than after
<!-- AC:END -->
