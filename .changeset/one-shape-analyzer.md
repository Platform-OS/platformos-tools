---
'@platformos/platformos-check-common': patch
'@platformos/platformos-language-server-common': patch
---

One answer to "what shape does this variable have", shared by the check and the editor.

`VariableShapeExtractor.ts` and the shape tracking inside `TypeSystem.buildSymbolsTable`
were a drifted copy of `UnknownProperty`'s analyzer, and carried every bug TASK-58 fixed:
`hash_assign` onto an unknown variable fabricated a hash holding only that key, lvalue paths
and `<<` were not writes at all, a `parse_json` body with interpolation and a filter after
`parse_json` were taken at face value, and GraphQL fragment spreads, inline fragments and
`@include`/`@skip` were ignored — so completion offered a fragment's nine fields as none.

`VariableShapeExtractor.ts` turned out to have no importers anywhere in the monorepo and was
deleted rather than fixed, along with `graphqlSchema.ts`, whose only consumer moved with the
GraphQL inference. `PropertyShapeInference.ts` is now presentation only. check-common exports
`checks/unknown-property/{property-shape,shape-analysis}` and `buildSymbolsTable` asks ONE
`createShapeAnalyzer` — 811 lines lighter, with argument-bound `{% function %}` return shapes
and their memoization for free.

Two seams keep the editor's own knowledge without a second tracker. `ShapeAnalyzerDeps`
gained an optional `resolveExternalShape`, which is how the docset reaches a hash literal
(`{ "user": context.current_user }`); a check passes nothing and gets exactly its previous
answers. And `resolvedTypeToShape` no longer fabricates: a documented object is a TYPE, not
a shape, and flattening `context` or `product` into one said "some value" while costing the
caller the docset entry hover and completion resolve from.

The `open`-for-writes question this raised is now decided. A write at a path onto a base with
no known shape produces an OPEN object carrying the written key, so completion offers the key
while no other read can be called unknown. `PropertyShape` gained `placeholder` to keep the
two open-nesses apart: an empty hash literal is a placeholder and CLOSES on the first visible
write — which is what makes `{% assign f = {} %}{% hash_assign f['page'] = 1 %}{{ f.tag }}`
reportable — while a shape that is open because we never saw the value stays open through any
number of writes. Without that distinction the new open shapes were silently closed on the
second write, worth 22 false positives on one real project.
