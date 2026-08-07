---
id: TASK-65
title: >-
  Own GraphQL parsing in platformos-common and parse each .graphql file once per
  change
status: Done
assignee: []
created_date: '2026-08-06 08:23'
updated_date: '2026-08-06 11:58'
labels:
  - refactor
  - platformos-common
  - platformos-check-common
  - performance
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`extractGraphqlTables` (packages/platformos-check-common/src/graphql-table.ts) is platformOS domain knowledge — how a platformOS GraphQL operation names its model tables — and belongs in `platformos-common` beside `extractSchemaTable`, `frontmatter`, `RouteTable` and `DocumentsLocator`. It was moved there once (TASK-9.22.1) and moved back in bcd862a with the rationale that `platformos-common` must sit below the parser stack. That rationale does not survive contact with `extractSchemaTable`, which parses YAML with `js-yaml` in this very package: the invariant that matters is browser-safe / no Node imports / no workspace parser package, not "no format reader at all".

The second half is the reason the placement matters: today a `.graphql` document is parsed by the `graphql` parser several times per lint run and again per editor interaction, because the AST an `AppFile` holds for a `.graphql` file is `{ type: 'Document', content }` — the source string, unparsed. Every consumer re-parses:

- `GraphQLCheck` — once per file per run;
- `GraphQLVariablesCheck` — one `fs.readFile` + one parse per `{% graphql %}` call site (ignores the App and the editor buffer entirely);
- `UnknownProperty` / the LSP type system — one parse per call site, through `inferShapeFromGraphQL(content)`;
- the graph build — one parse per GraphQL module.

Make the injected GraphQL parser produce the real document, so `AppFile.ast` memoizes it and a file is parsed once until it changes, which is exactly what `App` already guarantees for Liquid and YAML. Callers with a buffer and no file — the inline `{% graphql res %}…{% endgraphql %}` body — use the same exported `parseGraphql` util directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 platformos-common owns GraphQL parsing: parseGraphql, extractGraphqlTables and the operation's declared variables live under packages/platformos-common/src/graphql and are exported from its index; check-common no longer defines graphql-table.ts and re-exports the type rather than duplicating it
- [x] #2 platformos-common declares the graphql dependency and package-boundaries.spec.ts states the real invariant (browser-safe, no Node imports, no workspace parser package) rather than 'no parser'
- [x] #3 The GraphQL AST an AppFile holds carries the parsed document (and the syntax error when it does not parse) alongside the content, so file.ast.content consumers are unaffected
- [x] #4 GraphQLCheck, GraphQLVariablesCheck, UnknownProperty's shape analyzer and the graph's table extraction all read the parsed document from the App instead of parsing a string themselves
- [x] #5 A test proves a .graphql file referenced from several call sites is parsed EXACTLY once per lint run, and parsed again after its source changes — with a control that fails if a call site re-parses
- [x] #6 GraphQLVariablesCheck resolves its target through the App (so an unsaved editor buffer wins) instead of context.fs.readFile
- [x] #7 yarn build, yarn test and format:check pass across common, check-common, graph, language-server-common
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Executed approach (recorded after the fact — the deviations from the original sketch are noted).

1. **platformos-common/src/graphql/** — `parse.ts` (`parseGraphql`, `GraphQLDocumentNode`, `isGraphqlDocument`), `tables.ts` (`git mv` of check-common's `graphql-table.ts`), `variables.ts` (lifted from `GraphQLVariablesCheck`), `index.ts` barrel. Extractors take the parsed node, never a string, so no caller can parse twice by accident.
2. **Boundary** — add `graphql` to the package's dependencies and rewrite `package-boundaries.spec.ts`'s expectation and rationale: no workspace parser package, no Node import. Update the two comments (`src/index.ts`, `schema-table.ts`) that asserted the opposite.
3. **check-common** — `types.ts` re-exports the type instead of declaring it; `to-source-code.ts`'s `toGraphQLAST` delegates to `parseGraphql`, so the App's injected parser produces the real document; `src/index.ts` stops re-exporting the readers and `identity-ownership.spec.ts` grows a rule that pins that.
4. **Consumers read the App's parse** — `GraphQLCheck` (`ast.document` / `ast.syntaxError`), `GraphQLVariablesCheck` (`context.app.get` + fallback read), `UnknownProperty`'s `readGraphQL`, and the graph's two table sites (`traverse` / `incremental`). `inferShapeFromGraphQL` and `ShapeAnalyzerDeps.readGraphQL` change shape to carry the node.
5. **Deviation, added after review** — the language server was left on `fs` in step 4 (the plan was to note it as a follow-up). It is now App-backed: `TypeSystem` takes an `AppResolver`, and all three of its read-and-parse paths (`readGraphQL`, `readPartial`, `inferFunctionReturnType`) go through the `AppFile`, the last two via one shared `readLiquidFile`.
6. **Deviation, added after review** — `GraphQLCheck`'s schema gate. The plan deliberately preserved its silence; measurement of the docs manager (cached download + committed 13051-line fallback) showed the risk of flipping it was empty, so the syntax error is now reported before the schema is asked for. TASK-66.
7. **Verification** — a parse-once spec whose fixture makes the app's parse unreproducible; one LSP spec per read path with the App and the filesystem deliberately disagreeing; every one sabotage-checked. Then a real-project parse count (`htevent`) before and after, from the same instrumented CLI run.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GraphQL reading now belongs to `platformos-common`, and a `.graphql` file is parsed exactly once until its source changes.

**Moved / added (platformos-common, new `src/graphql/`)**
- `parseGraphql(content) -> GraphQLDocumentNode` — `{ type, content, document?, syntaxError? }`. The syntax error is a value on the node, not the `Error` a `Parser` may return, because an `Error` AST would take the file out of the pipeline `GraphQLCheck` reports from. No cache inside it: the `AppFile` is the cache.
- `extractGraphqlTables(node)` — moved from check-common's `graphql-table.ts` with `git mv` (history preserved), now taking the parsed node.
- `extractGraphqlVariables(node)` — moved out of `GraphQLVariablesCheck`. Keeps the `undefined` (did not parse) vs `[]` (declares none) distinction, which is what stops an unrelated syntax error from producing a pile of false "Unknown parameter" offenses.
- `isGraphqlDocument(ast)` for callers holding the `AST | Error` union.
- `graphql` added to the package's dependencies; `package-boundaries.spec.ts` now states the invariant it always meant — no WORKSPACE parser package and no Node import — rather than "no parser". `js-yaml` was already there for exactly the same reason (`extractSchemaTable`).

**Parse-once wiring**
- `sourceParsers[GraphQL]` injects `parseGraphql`, so `AppFile.ast` holds the real document.
- `GraphQLCheck` reads `ast.document` / `ast.syntaxError`, and reports a syntax error BEFORE asking for the schema — only `validate()` needs one (TASK-66, fixed in this change after review).
- `GraphQLVariablesCheck` resolves through `context.app` instead of `fs.readFile`, so it sees unsaved editor buffers and pays one parse per document rather than one read + one parse per call site.
- `UnknownProperty`: `ShapeAnalyzerDeps.readGraphQL` returns `{ uri, ast }`, `inferShapeFromGraphQL` takes the node. Inline `{% graphql %}…{% endgraphql %}` bodies, which have no file, call `parseGraphql` directly.
- `platformos-graph` (traverse + incremental) reads tables off `sourceCode.ast`.
- The language server's `TypeSystem` takes an optional `AppResolver` (5th ctor arg; `CompletionsProvider` passes `documentManager.appModel`), threaded to `shapeAnalyzerDeps`. All three of its per-call-site read-and-parse paths now prefer the `AppFile`: `readGraphQL`, the shape analyzer's `readPartial`, and `inferFunctionReturnType` — the last two through one shared `readLiquidFile(uri, fs, app)`, so there is a single answer to "this partial's source and parse". A host with no app (`HoverProvider` builds a `TypeSystem` without even a filesystem) still reads and parses, but a per-deps memo makes that once per symbols table rather than once per call site.

**Measured** (`htevent`, 453 `.graphql` files) by counting every call into `graphql`'s `parse` during a full CLI run: **2442 parses before, 505 after**, same 15511 offenses. Wall clock unchanged within noise (115.9 s → 114.1 s) — a full lint is dominated by Liquid parsing, so this is a removed cost, not a headline speed-up; it pays off where the same document is read repeatedly against a warm app (LSP inference, supervisor `validate_code`).

**Tests, each sabotage-checked before being trusted.**
- `graphql-parse-once.spec.ts` pins one parse per document per run and a re-parse after `setSource`. Its fixture makes the app's parse UNREPRODUCIBLE — the source carries a token that is not GraphQL and the injected parser strips it while keeping the original as `content` — so a consumer that parses the file, the buffer or `ast.content` again shows up in the offenses, not merely in a counter. Bypassing the app in `GraphQLVariablesCheck` fails 2 tests, in `UnknownProperty` 2, re-parsing in `GraphQLCheck` 3.
- `TypeSystem.spec.ts` gained one test per LSP read path, each with a version in the App the filesystem does not have. Sabotaged individually: `readLiquidFile` fails both partial tests, `readPartial` only the analyzer one, `inferFunctionReturnType` only the return-type one — so they are independent rather than redundant.
- `GraphQLCheck`'s single "no offenses without a schema" test became a pair: an unknown FIELD stays silent, a SYNTAX error must still fire. That control is what the old test lacked — its fixture was syntactically valid.
- `identity-ownership.spec.ts` gained a second owner rule: no check package re-exports the GraphQL readers.

Full suite green: 357 files / 3858 tests; `format:check` clean; `yarn install --frozen-lockfile` with zero yarn.lock churn.
<!-- SECTION:FINAL_SUMMARY:END -->
