---
id: TASK-111
title: >-
  A GraphQL query naming a table no schema declares is reported by nothing, at
  any layer
status: In Progress
assignee: []
created_date: '2026-09-07 18:03'
updated_date: '2026-09-07 19:07'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#6 settled by measurement, before any code

**The question:** does a table declared by a module that is not in the local checkout produce a false positive, and if so must the check suppress?

**Three findings.**

1. **The join works, module schemas included.** On a probe project, `app.ofType(PlatformOSFileType.Table)` returned BOTH `app/schema/app_table.yml` and `modules/blog/public/schema/module_table.yml`, and `extractSchemaTable` read each `name:`. So module coverage needs no special handling — the existing path machinery already provides it. That is AC#3 answered too.

2. **An unmatched table CANNOT be attributed to a module.** A table name carries no module. So the only absence-aware policy available is a BLANKET one: if any declared module is uninstalled, suppress every unmatched-table report. That would silently disable the check for exactly the projects that use modules — worse than the false positive it avoids.

3. **DECISIVE — the codebase already reports in this situation.** A project whose `pos-module.lock.json` declares `absent_module`, with no `modules/absent_module/` on disk, rendering a partial from it:

   ```
   MissingPartial: 'modules/absent_module/some_partial' does not exist
   ```

   So "module declared but not installed → report" is the established, shipped behaviour of the nearest neighbour. A new check doing the same is CONSISTENT rather than novel.

**Decision.** Report, and mirror `MissingPartial`'s escape hatch (an ignore array in the check schema) rather than inventing suppression logic. Rejected: reading `pos-module.lock.json` / `app/pos-modules.lock.json` to detect uninstalled modules — the toolchain reads none of those formats today (grep: zero references in `packages/`), it would add two legacy spellings to track, and per finding 2 it could only be applied bluntly.

## The sweep (AC#8) caught a systematic false positive before release

First run over real projects: **54 offenses**, and inspection showed most were WRONG. Every false one traced to a single false premise of mine.

**THE TABLE IS NOT THE YAML `name:`.** The platform runs a schema's declared name through `ParameterizedName`: it prefixes `modules/<module>/` for a schema inside a module (unless the name already carries it), then downcases and turns spaces into underscores. `records_filter_input.rb:12` maps the GraphQL `table` argument to `parameterized_name`, and `custom_model_type.rb:59` builds a `records_delete_all(table:)` from it — so that IS the value a query must spell. A module schema whose `name:` is `profile` is queried as `modules/user/profile`.

Read from the platform source, and independently consistent with real projects, which query exactly that.

Added `parameterizedTableName(name, moduleName?)` to `platformos-common` beside `extractSchemaTable`, since it is platform knowledge rather than check logic. The check composes it with `AppFile.moduleName`.

**Result: 54 → 34 offenses, and all 34 attributable.** `list-app` 18→0, `2` 16→0, `1` 3→0.

| project | total offenses | MissingTable | what they are |
|---|---|---|---|
| arabbank-master | 13,071 | 6 | `promo_code_details` queried, schema declares `promo_code_detail`; `category_detail` ×5, undeclared |
| pos-opencode-app | 382 | 12 | `board`, undeclared |
| test-instance | 896 | 12 | `board`, undeclared |
| 9/poetry-blog | 620 | 4 | `related_record(table: "user")` — the platform's own field docs call that argument a record-schema name, and `related_user` is the field for users |
| list-app, 1, 2, DEMO, multiproj/1, multiproj/2, 002/blog, supervisor-tests | 0–572 | 0 | — |

One project (`product-marketplace-template-master`) exits 0 with empty stdout from the CLI — a pre-existing anomaly unrelated to this check, since offenses go to stdout. Noted, not chased.

## Two measurement-method errors of my own, both caught

- The first sweep counted with `grep -c` over a `sed` range. When the offenses array is EMPTY it prints as `[]` on one line, so the range never closed and ran on into the config dump, which names `MissingTable` twice — inflating empty projects to 2. Recounted by parsing the JSON.
- My "declared schema names" listing globbed only `*/schema/*.yml` and missed `app/model_schemas/`. The CHECK read those correctly; my inspection did not, which briefly made a project look schema-less.

## Also verified

- **Supervisor path**: `runValidateCode` on the probe project reports `absent_table` and stays silent on the app and module tables — so the supervisor's App does carry project schemas. This was the risk that would have made the check unusable there.
- **AC#2**: `BLOCKING_CHECKS.has('MissingTable') === false`, and a reporting file comes back `status: error` with `must_fix_before_write: false`.
- **AC#7**: registered in `src/checks/index.ts`; factory configs regenerated — `MissingTable` is in both `all.yml` and `recommended.yml`.

## Scope deliberately held

`platformos-graph`'s `SchemaModule.table` still records the raw `name:`. Correcting the VALUE needs module context the graph does not carry, and it has no consumer today. But its doc comment claimed the value was joinable against `GraphQLModule.tables`, which is now knowably false for a module schema — so the comment is corrected and points at `parameterizedTableName`. Comment only; no behaviour change.
<!-- SECTION:NOTES:END -->
