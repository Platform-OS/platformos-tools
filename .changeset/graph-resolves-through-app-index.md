---
'@platformos/platformos-graph': minor
'@platformos/platformos-language-server-common': patch
---

The graph resolves reference names through the `App` index its caller already holds.

`IDependencies` gains `app`, the companion to `getSourceCode`: a caller that has an
`App` hands it over for BOTH, so a graph build reuses the project model's parses AND its
name index. `traverse.ts` passes it to `DocumentsLocator`, and the language server's
`AppGraphManager` supplies the same `App` it already reads sources through.

It cannot change the ANSWER, only its cost. `App.findOrLocate` is index-first and falls
through to the very candidate walk the walk-only stand-in performs, in
`getAppPaths`/`getModulePaths` order either way — so an index that is empty, partial or
stale resolves exactly as before. What it removes is the I/O: without an app, every
`{% render %}`, `{% include %}`, `{% function %}`, `{% background %}`, `{% graphql %}`
and `layout:` in the project costs one `readDirectory` per candidate DIRECTORY, on a
project the language server had just walked and indexed. Measured over a whole-project
build on three real projects — directory listings, then median wall clock of three runs,
with the graph compared node-for-node:

| project | files | listings | build |
|---|---|---|---|
| arabbank | 3450 | 6993 → **590** | 12.1 → 11.7 s |
| Accala-MP | 3623 | 9911 → **185** | 7.3 → 7.1 s |
| pos-module-community | 1622 | 11787 → **762** | 4.8 → 4.0 s |

Identical graphs on all three. **The wall-clock win is the small half** (3-15%): a full
build is dominated by parsing every reachable file, and no index changes that. What goes
away is 92-98% of the I/O, which is the part that scales with how many references a
project has rather than how much source it has. The listings left are the two that must
remain: an asset lookup (never indexed — nothing reads an asset, so the only question is
whether it still exists on disk) and a name the index genuinely cannot answer.

Graphs are also pinned identical across three arms in the suite — a whole app, no app,
and an app holding only the entry points, so that every target is an index miss — on both
the plain and the module-prefixed fixtures.

Two comments corrected while measuring this, both of which pointed the next reader the
wrong way:

- `graphParsers` claimed the MCP supervisor was a "consumer-to-be" of
  `appBackedGetSourceCode`. It is not, and the reason is now written down: its full
  builds run on a worker thread (a second heap on purpose) which cannot share `AppFile`
  objects at all, and its incremental apply must not read through check-node's shared
  `App`, which carries unsaved editor buffers and is mutated by concurrent lints while
  the graph cache is an authority on DISK state. There is also nothing to win —
  `lintBuffers` parses the content it was handed and drops the app's entry for that file
  on the way out, so the file a reconcile parses is precisely the one whose parse no lint
  would have reused.
- The same doc implied a graph build needs the `.js`/image parsers. It does not:
  `traverseModule` returns immediately for an Asset node and the only fact the graph
  wants about an asset is whether it exists (`fs.stat`). Every file a build READS is
  Liquid, GraphQL or YAML, so `sourceParsers` alone is enough to back one. The entries
  exist for `toSourceCode`'s total contract and for an `App` that an asset URI is put
  into. Pinned by a test asserting the build asks for no asset source code, with the
  Liquid files it does read as the control.
