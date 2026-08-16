export { buildAppGraph } from './graph/build';
export { enumerateEdgeSources, isEdgeSource } from './graph/edge-sources';
export { extractFileReferences, extractStructural } from './graph/traverse';
export {
  dependenciesOf,
  dependentsOf,
  exists,
  isEntryPoint,
  isOrphan,
  orphans,
  reachableFrom,
  missingDependencies,
  missingTargets,
  nearestModules,
} from './graph/query';
export type { NearestModulesOptions } from './graph/query';
export { serializeAppGraph } from './graph/serialize';
export { parseJs, toSourceCode } from './toSourceCode';
export { appBackedGetSourceCode, graphParsers } from './parsers';
export * from './types';
