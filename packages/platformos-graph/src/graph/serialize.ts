import { SerializableEdge, SerializableGraph, SerializableNode, AppGraph } from '../types';

export function serializeAppGraph(graph: AppGraph): SerializableGraph {
  const nodes: SerializableNode[] = Object.values(graph.modules).map((module) => ({
    uri: module.uri,
    type: module.type,
    kind: module.kind,
    ...('exists' in module ? { exists: module.exists } : {}),
  }));

  const edges: SerializableEdge[] = Object.values(graph.modules).flatMap(
    (module) => module.dependencies,
  );

  return {
    rootUri: graph.rootUri,
    nodes,
    edges,
  };
}
