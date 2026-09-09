---
id: TASK-110
title: >-
  GraphQL table extraction misses four mutations and reports remote tables as
  local
status: Done
assignee: []
created_date: '2026-09-07 18:03'
updated_date: '2026-09-07 18:32'
labels:
  - platformos-common
  - platformos-graph
  - measured
dependencies: []
priority: medium
ordinal: 77000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while assessing whether the supervisor could report a GraphQL table no schema declares (the follow-up task). The join it would need is already half-built, and the extractor feeding it has two defects.

`extractGraphqlTables` visits only `ObjectField` nodes named `table`. MEASURED against the built package:

| construct | extracted | should be |
|---|---|---|
| `records(filter: { table: { value: "x" } })` | `["x"]` | correct |
| `records(filter: { table: "x" })` | `["x"]` | correct |
| `record_delete(id: 1, table: "x")` | **`[]`** | `["x"]` |
| `records_delete_all(table: "x")` | **`[]`** | `["x"]` |
| `records_update_all(table: "x", record: {})` | **`[]`** | `["x"]` |
| `remote_records(endpoint: {...}, filter: { table: { value: "x" } })` | **`["x"]`** | nothing — other instance |
| `admin_table_create(table: { name: "x" })` | `[]` | correct — defines, does not reference |

**Defect 1 — direct arguments are invisible.** Live introspection of the root mutation type shows six fields taking a `table` argument; four of them (`record_delete`, `records_delete_all`, `records_update_all`, `property_upload_presigned_url`) pass it as a plain `String` ARGUMENT, which is an `Argument` node, not an `ObjectField`. The extractor never sees them.

This is not only a blocker for the new check — it is a live gap today. `platformos-graph` sets `module.tables` from this function (`traverse.ts:94`), so a `.graphql` file whose only table reference is one of those mutations joins to no schema. Impact therefore under-reports which schemas a destructive mutation touches.

**Defect 2 — remote tables are reported as local.** `remote_records` takes the SAME `RecordsFilterInput` as `records`, so its `table` names a table on a DIFFERENT instance. The extractor has no parent context and returns it. Anything joining these against local schema files would flag every remote query.

## Why this is worth fixing on its own

The two extractors are documented as siblings "so a consumer can join a GraphQL operation to the schema it targets", and the graph already records both halves (`module.tables` at `traverse.ts:94`, `module.table` at `:102`, with `types.ts:161` describing them as joinable). Nothing joins them yet, but the graph edge quality depends on the extractor being right either way.

## Oracles

- Live GraphQL introspection of `RootQuery` / `RootMutation` on an instance — which fields take `table`, and in what position.
- The built `platformos-common` package run against each shape, which is where the table above comes from.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A `table` passed as a direct ARGUMENT is extracted: `record_delete`, `records_delete_all`, `records_update_all` and `property_upload_presigned_url` all take it that way and all currently return []
- [x] #2 A table under `remote_records` is NOT extracted — it names a table on another instance, and the endpoint argument is what distinguishes it
- [x] #3 CONTROL: both existing filter forms still extract — `filter: { table: "x" }` and `filter: { table: { value: "x" } }`
- [x] #4 CONTROL: `admin_table_create` / `admin_table_update` stay unextracted — they DEFINE a table rather than reference one, and their arg is a `TableInputType` whose `name` is not a reference
- [x] #5 CONTROL: a dynamic (non-string) table still yields nothing, so a `$table` variable is never reported
- [x] #6 CORRECTED: the graph's `module.tables` reflects the fix, proven by a graph-level test on a mutation-only fixture. The original wording said such a file would 'join to the schema it writes to' — that is wrong for THIS task: nothing joins tables to schemas yet, which is exactly what TASK-111 adds. The join half moves there.
- [x] #7 The argument/ObjectField split is covered by a test per shape, derived from a live introspection of the root mutation fields rather than from memory
- [x] #8 Tables nested through `RecordsFilterInput.or` are still extracted — `or` is a list of the same input type, so filters nest arbitrarily deep
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

`extractGraphqlTables` is three visitors and no helper functions:

- `Field` — returns `false` when the field carries an `endpoint` argument, which drops the whole subtree, ARGUMENTS INCLUDED. This is the only thing that needs field context, and it only needs it in order to skip.
- `Argument` — a `table` argument is a reference when its value is a STRING.
- `ObjectField` — `table: "x"` and `table: { value: "x" }`, at any depth and in any position.

`Kind` is now imported; `visit` does the recursion, so the first draft's `collectFromArgument` / `collectFromValue` are gone.

## Two defects I introduced and then found by re-checking

Neither was caught by the first 20-case matrix, because every case in it put the table under a field — the same blind spot as the bug being fixed.

**1. A field-scoped walk lost tables no field encloses.** Confirmed as a real regression by running the pre-change function against the same document rather than reasoning about it:

```graphql
query find($filter: RecordsFilterInput = { table: { value: "blog_post" } }) {
  records(per_page: 20, filter: $filter) { results { id } }
}
```

`OLD: ["blog_post"]`, `NEW: []`. A reusable query with an overridable default table is ordinary. Named and inline fragments were the same class of miss.

**2. Collecting the direct argument at field-enter broke document order.** `records_update_all` takes BOTH a `filter` and a `table`, so the argument was always added first regardless of source order — violating this function's own documented "every distinct string table in document order":

```
records_update_all(filter: { table: { value: "from_filter" } }, table: "from_arg", record: {})
  document order  from_filter, from_arg
  extracted       ["from_arg", "from_filter"]
```

Fixed by visiting `Argument` nodes rather than looping at field-enter, so `visit` walks arguments in document order. Verified in both directions.

The lesson both share: "walk fields, then read their arguments" is narrower than the contract. The final shape lets the field visitor do ONLY the remote skip and leaves every other position to node-kind visitors that `visit` traverses correctly.

## Verification

- 34 cases in `tables.spec.ts` (from 17); 47 across the package's graphql specs.
- Two graph-level tests on new fixtures (`table_as_argument.graphql`, `remote_table.graphql`, both referenced from the fixture page so the build reaches them), proving `module.tables` end to end rather than only at the unit boundary.
- Sabotage against the FINAL code, each killing only its own tests: drop the `Argument` visitor → 7 fail; drop the remote subtree skip → 2; accept any argument value kind → 3; remove the `ObjectField` visitor → 18. An earlier round also drove the argument sabotage through `dist` and watched the graph test fail, which is what proves that layer is genuinely wired.
- Full monorepo suite **4545 tests across 357 files, 0 failures**. This mattered: `check-common`, the language server and the supervisor all consume this through `dist`, and the remote exclusion changes what the graph records.
- Type-check and prettier clean.

## Note on the earlier suite runs

Two full-suite passes during this task (4539 tests) were against the pre-rewrite code and were discarded rather than counted — a green run against code you have since replaced verifies nothing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`extractGraphqlTables` now sees the four mutations that pass `table` as a plain argument, and no longer reports a remote instance's tables as local.

Both defects were measured before being fixed: live introspection of the root query and mutation types established which fields take `table` and in what position, and which take `endpoint`. `record_delete`, `records_delete_all`, `records_update_all` and `property_upload_presigned_url` declare it as a `String` ARGUMENT — an `Argument` node, invisible to a walk that only looked at object fields. `remote_records` shares `RecordsFilterInput` with `records`, so its table names a table on another instance.

The under-report was live, not just a blocker for TASK-111: `platformos-graph` builds a GraphQL module's `tables` from this function, so a document whose only reference was one of those mutations recorded no table — a file that DELETES from a model joined to nothing, and impact under-reported which schema a destructive mutation touches.

Implementation is three visitors: `Field` skips a remote subtree, `Argument` reads the string form, `ObjectField` reads both filter forms at any depth. Two exclusions fall out rather than being listed — `admin_table_create` / `admin_table_update` are skipped because only a STRING argument counts as a reference (verified against the schema that neither input type carries a nested `table`), and remote fields are found by the presence of `endpoint`, which is non-null on every one of them, so no list of field names has to be maintained.

I introduced two defects along the way and caught them by re-checking rather than by a failing test: a field-scoped walk silently dropped a table in a variable's default value or a fragment, and collecting the direct argument at field-enter broke the documented document-order contract. Both are now pinned by tests that fail against the designs that caused them.

34 spec cases (from 17), two graph-level tests on new fixtures, four sabotages each killing only its own tests, full suite 4545/4545 across 357 files, type-check and prettier clean. Left uncommitted on `fix/table-extraction-misses-mutation-arguments-and-returns-remote-tables` with a changeset. TASK-111 is now unblocked.
<!-- SECTION:FINAL_SUMMARY:END -->
