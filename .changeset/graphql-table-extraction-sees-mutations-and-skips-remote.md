---
'@platformos/platformos-common': patch
'@platformos/platformos-graph': minor
---

GraphQL table extraction now sees the four mutations that pass `table` as an argument, and no
longer claims a remote instance's tables as local.

`extractGraphqlTables` walked the document for object fields named `table`. That is one of the
three positions a table actually appears in, measured against a live schema rather than assumed:

```graphql
records(filter: { table: { value: "blog_post" } })   # object   — was found
records(filter: { table: "blog_post" })              # shorthand — was found
record_delete(id: 1, table: "blog_post")             # ARGUMENT — was MISSED
```

`record_delete`, `records_delete_all`, `records_update_all` and `property_upload_presigned_url`
all declare `table` as a plain `String` argument, which is an `Argument` node rather than an
`ObjectField`, so none of them was seen. `platformos-graph` builds a GraphQL module's `tables`
from this function, so a document whose only table reference was one of those recorded NO table —
a file that DELETES from a model joined to nothing, and impact under-reported which schema a
destructive mutation touches.

The opposite error was also present. `remote_records` takes the same `RecordsFilterInput` as
`records`, so its table names a table on ANOTHER instance; the walk had no context and returned
it as if it were local.

Only the remote exclusion needs the FIELD, and only in order to skip: the walk drops that
field's whole subtree, arguments included. Everything else stays a document-wide search, which
is what keeps a table in a position no field encloses — a variable's default value, say —
covered:

- a `table` argument is a reference when it is a STRING. That covers the four mutations, and it
  is also why `admin_table_create` / `admin_table_update` stay out for free — they DEFINE a table
  and pass an input object. Checked against the schema: neither input type carries a nested
  `table` field that could leak through the value walk.
- a field carrying an `endpoint` argument is remote, and everything under it is skipped.
  `endpoint` is non-null on every remote field, so nothing has to maintain a list of names.
- object fields named `table` are still read at any depth and in any position, which matters
  because `RecordsFilterInput.or` is a list of `RecordsFilterInput` so filters nest
  arbitrarily, and because a filter can also arrive as a variable's default value or from
  inside a fragment.

Unchanged: a dynamic (non-string) table still yields nothing, so a `$table` variable is never
reported; a field aliased `table` in a selection set is still not a table; and a document that
does not parse still returns an empty array.
