---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': minor
'@platformos/platformos-graph': patch
'@platformos/platformos-language-server-common': patch
---

How a platformOS GraphQL document is READ now lives in `platformos-common`, and a
`.graphql` file is parsed exactly once until its source changes.

`parseGraphql`, `extractGraphqlTables` and `extractGraphqlVariables` are platformOS
domain knowledge — what a table filter looks like, what a `{% graphql %}` call site may
and must pass — so they sit beside `extractSchemaTable`, the schema `name:` those tables
join to, rather than inside the linter. `platformos-check-common` no longer defines
`graphql-table.ts` and re-exports none of them; it re-exports only the
`GraphQLDocumentNode` TYPE, exactly as it re-exports `SourceCodeType`.

**The placement is what makes the parse shareable.** The GraphQL "AST" an `AppFile` held
was `{ type: 'Document', content }` — the source string, unparsed — so every consumer
parsed it again for itself:

- `GraphQLCheck`, once per file per run;
- `GraphQLVariablesCheck`, one `fs.readFile` **plus** one parse per `{% graphql %}` call
  site — which also meant it read the disk while the editor held an unsaved buffer;
- `UnknownProperty` and the language server's type system, one parse per call site;
- the graph build, one more.

`sourceParsers` now injects `parseGraphql`, so the `AppFile` memoizes the real document
and all four read that one. Measured on a real project (`project-c`, 453 `.graphql` files)
by counting every call into `graphql`'s `parse` during a full CLI run: **2442 parses
before, 505 after**, for the same 15511 offenses. Wall clock is unchanged within noise
(115.9 s → 114.1 s) — a full lint of that project is dominated by Liquid parsing, so this
is a cost removed rather than a speed-up to advertise. It matters most where the same
document is read over and over against a warm app: the language server's per-keystroke
type inference, and the MCP supervisor's per-write `validate_code`.

`GraphQLDocumentNode` gains `document?` and `syntaxError?` alongside `content`, which is
unchanged — a document that does not compile is a normal state `GraphQLCheck` reports
on, so the error is a value on the node rather than the `Error` a parser may return,
which would take the file out of the very pipeline that reports it.

**`GraphQLCheck` now reports a syntax error even when the docset has no schema.** It used
to gate the whole check on `platformosDocset.graphQL()`, so a document that did not
compile drew nothing — and the test pinning that silence used a syntactically VALID
fixture, so nothing distinguished "no schema to compare against" from "says nothing at
all". A syntax error needs no schema; only `validate()` does. This changes no Node run:
the docs manager downloads the schema to its cache and falls back to the copy committed
in `platformos-check-docs-updater/data/graphql.graphql`, so `null` reaches the check only
from a caller that injects its own docset — a browser embedder, or a test. The silence
that remains (an unknown FIELD, without a schema) now has that syntax test beside it as
its control.

Callers with a buffer and no file — an inline `{% graphql res %}…{% endgraphql %}` body
— call `parseGraphql` directly. There is no cache inside it: the `AppFile` is the cache,
and a second content-keyed one behind it would be a different answer to what a file's
parse is.

`inferShapeFromGraphQL(node, schema?, args?)` and `ShapeAnalyzerDeps.readGraphQL` now
take and return the parsed node instead of a string.

The language server's `TypeSystem` takes an optional App resolver (`CompletionsProvider`
passes `DocumentManager.appModel`) and reads through the `AppFile` its own diagnostics
already parsed — for `.graphql` documents and, by the same `readLiquidFile`, for the
LIQUID PARTIALS behind `{% function %}`, which were read and re-parsed by BOTH the shape
analyzer's `readPartial` and `inferFunctionReturnType`, once per call site, per request.
So completion and hover cost a lookup instead of a read and a parse, and cannot disagree
with the diagnostic beside them about what a partial says. A host with no app (the hover
provider builds a type system without even a filesystem) still reads and parses, but once
per symbols table now rather than once per call site.

Pinned by `graphql-parse-once.spec.ts`, whose fixture makes the app's parse
unreproducible — the source carries a token that is not GraphQL and the injected parser
strips it — so a consumer that parses the file, the buffer or `ast.content` again is
visible in the offenses, not merely in a counter. The language server's path is pinned the
same way: its fixture puts a document in the App that the filesystem does not have, so a
read that went to disk infers the wrong shape. `platformos-common`'s
`package-boundaries.spec.ts` now states the invariant it always meant: no workspace
parser package and no Node import, rather than "no parser" — `js-yaml` was already there
for the same reason `graphql` is now.
