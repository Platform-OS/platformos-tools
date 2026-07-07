import { UriString } from '@platformos/platformos-check-common';

import {
  AppGraph,
  AppModule,
  LiquidModuleKind,
  ModuleType,
  SerializableGraph,
  SerializableNode,
} from '../types';
import { assertNever } from '../utils';
import { internModule } from './module';

/**
 * Reconstruct an in-memory {@link AppGraph} from its serialized form (the inverse
 * of {@link serializeAppGraph}) — the load half of graph persistence.
 *
 * Nodes are rebuilt and INTERNED into the graph's identity cache (via
 * {@link internModule}) so a subsequent incremental update (`applyFileChange`)
 * resolves to these exact module objects rather than minting duplicates on a
 * cache miss. Each serialized edge is pushed onto BOTH its source's
 * `dependencies` and its target's `references` as a single shared instance,
 * mirroring `bind`, so the reverse index is complete. Entry points are restored
 * from `entryPointUris` (which the serialized form does not carry — the caller
 * persists them alongside the graph) so orphan/reachability semantics and the
 * incremental GC rule match a from-scratch build.
 *
 * Round-trip identity: `serializeAppGraph(deserializeAppGraph(s, e))` deep-equals
 * `s` (modulo ordering). Note the neutral leaf `table` fact is not part of the
 * serialized form, so it is absent on a deserialized graph until an incremental
 * update re-derives it — a documented persistence limitation (`table` is not
 * consumed by the blast-radius query the cache serves).
 */
export function deserializeAppGraph(
  serialized: SerializableGraph,
  entryPointUris: UriString[] = [],
): AppGraph {
  const graph: AppGraph = { rootUri: serialized.rootUri, entryPoints: [], modules: {} };

  for (const node of serialized.nodes) {
    graph.modules[node.uri] = internModule(graph, nodeToModule(node));
  }

  for (const edge of serialized.edges) {
    const source = graph.modules[edge.source.uri];
    const target = graph.modules[edge.target.uri];
    // A dangling edge (source/target absent from the node set) would be a
    // malformed serialization; skip it rather than throw so a partial/corrupt
    // cache degrades to a best-effort load (the fingerprint still gates freshness).
    if (!source || !target) continue;
    source.dependencies.push(edge);
    target.references.push(edge);
  }

  graph.entryPoints = entryPointUris
    .map((uri) => graph.modules[uri])
    .filter((module): module is AppModule => module !== undefined);

  return graph;
}

/** Build the concrete {@link AppModule} for a serialized node (empty edge lists — wired by the caller). */
function nodeToModule(node: SerializableNode): AppModule {
  // `exists` is only present on the node when it was set on the source module;
  // preserve that presence/absence so the round-trip is exact.
  const existsField = node.exists !== undefined ? { exists: node.exists } : {};
  const base = { uri: node.uri, dependencies: [], references: [], ...existsField };

  switch (node.type) {
    case ModuleType.Liquid:
      return { ...base, type: ModuleType.Liquid, kind: node.kind as LiquidModuleKind };
    case ModuleType.Asset:
      return { ...base, type: ModuleType.Asset, kind: 'unused' };
    case ModuleType.GraphQL:
      // `tables` is a re-derived leaf fact (not serialized) — default to empty;
      // the fingerprint-driven incremental reconcile re-reads it from disk.
      return { ...base, type: ModuleType.GraphQL, kind: 'graphql', tables: [] };
    case ModuleType.Schema:
      return { ...base, type: ModuleType.Schema, kind: 'schema' };
    default:
      return assertNever(node.type);
  }
}
