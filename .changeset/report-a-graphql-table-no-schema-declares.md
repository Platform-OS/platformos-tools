---
'@platformos/platformos-check-common': minor
'@platformos/platformos-common': patch
'@platformos/platformos-graph': patch
---

New check `MissingTable`: a GraphQL operation naming a model table that no schema declares.

A typo'd table was invisible at every layer. Measured on a live instance:

```graphql
records(per_page: 1, filter: { table: { value: "no_such_table_xyz" } }) { total_entries results { id } }
```

renders `{"records":{"total_entries":0,"results":[]}}` — a success with zero rows. Not a parse
error, not a schema error, not a deploy rejection, no runtime error, no log entry. A misspelled
table is indistinguishable from an empty one, forever.

`GraphQLCheck` cannot cover this however good the docset gets: `RecordsFilterInput.table` is a
`StringFilter`, not an enum, so every value is valid against the schema. Only a project-aware
check can, because the vocabulary is whatever the project's schema files declare — and that
vocabulary is COMPLETE, since `admin_tables` on a live instance holds only what deployed schemas
created. There are no platform-provided tables to allow for.

`MissingTable` is **not** blocking. The file deploys and runs; it just returns nothing. It is an
error in the report and absent from `BLOCKING_CHECKS`, so it never gates a write.

THE TABLE IS NOT THE YAML `name:`. The platform runs a schema's declared name through
`ParameterizedName`, which prefixes `modules/<module>/` for a schema inside a module and then
downcases and underscores it; `records_filter_input.rb` maps the GraphQL `table` argument to that
`parameterized_name`. So a module schema whose `name:` is `profile` is queried as
`modules/user/profile`. `parameterizedTableName` is that rule, exported beside
`extractSchemaTable`. Swept over twelve real projects, this one point accounted for every false
positive: 54 offenses before it, 34 after, and all 34 attributable — including a project querying
`promo_code_details` against a schema declaring `promo_code_detail`, and another reaching for
users with `related_record(table: "user")` where the platform expects `related_user`.

`SchemaModule.table` in `platformos-graph` still records the raw `name:`, which is correct for an
app schema and NOT joinable for a module one. Its comment now says so and points at
`parameterizedTableName`; the value is unchanged because nothing joins it yet.

Two escape hatches, because a table can legitimately exist outside the checkout: the check's
`ignoreMissing` list, and a blanket silence when the project has no schema files at all — a state
that cannot be told apart from "this run never saw them", where reporting would be a wall of
noise in exchange for nothing.
