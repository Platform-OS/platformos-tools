---
'@platformos/platformos-graph': minor
---

The graph answers questions, updates in place, and survives a restart.

**Query API** (`query.ts`) — `dependentsOf` / `dependenciesOf`, `reachableFrom`, `orphans` /
`isOrphan`, `isEntryPoint`, `exists`, `missingDependencies` / `missingTargets`, and
`nearestModules` (edit-distance "did you mean" over real module names). `dependentsOf` is
what the MCP supervisor's blast radius reads: the incoming references a per-file lint cannot
see, because lint is forward-looking and per-file.

**Incremental update** (`incremental.ts`) — `applyFileChange(graph, uri, kind, fs)` applies
one file's add/modify/delete in time proportional to that file rather than to the project.
A consumer that reconciles per change no longer pays a whole-project parse to learn that one
partial gained a caller.

**Persistence** (`deserialize.ts`) — a graph can be serialized and reloaded, so a fresh
process starts from a persisted graph plus the on-disk delta instead of a full build.

**`enumerateEdgeSources`** (`edge-sources.ts`) — the graph now owns the definition of which
files are edge sources, beside the classifier that decides it. It was previously re-derived
by the supervisor's cache, which is two answers to one question that must agree; the consumer
is now pure. The enumeration is ANCHORED on the platformOS source subtrees rather than
walking the whole tree and skipping directories by name — a bundled `react-app/` is never
descended into, and `app/views/pages/vendor/**` is a real site section that any `vendor`
blacklist would have dropped.
