export { buildAppGraph } from './graph/build';
export { applyFileChange } from './graph/incremental';
export type { FileChangeKind } from './graph/incremental';
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
export { deserializeAppGraph } from './graph/deserialize';
export { parseJs, toSourceCode } from './toSourceCode';
export * from './types';
