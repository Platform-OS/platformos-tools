import {
  recursiveReadDirectory as findAllFiles,
  getFileType,
  isLayout,
  isPage,
  path,
  PlatformOSFileType,
  UriString,
} from '@platformos/platformos-check-common';
import { IDependencies, AppGraph, AppModule, GraphBuildOptions } from '../types';
import { augmentDependencies } from './augment';
import { getModule, getSchemaModule } from './module';
import { traverseModule } from './traverse';

/**
 * Build the project dependency graph.
 *
 * - `entryPoints` omitted → FULL build: a single directory sweep discovers pages
 *   + layouts (the render entry points) and standalone custom-model-type/schema
 *   nodes, and every reachable module is materialized.
 * - `entryPoints` provided → SCOPED build (e.g. an LSP rebuild for changed
 *   files): built verbatim from those roots. Schema nodes are NOT auto-discovered
 *   in this mode — schema discovery is a full-build concern.
 *
 * `options.includeStructural` (default off) additionally populates each
 * `LiquidModule.structural`; see {@link GraphBuildOptions}.
 */
export async function buildAppGraph(
  rootUri: UriString,
  ideps: IDependencies,
  entryPoints?: UriString[],
  options: GraphBuildOptions = {},
): Promise<AppGraph> {
  const deps = augmentDependencies(rootUri, ideps);

  // Schema/custom-model-type files are platform nodes but are NOT render-reachable
  // (nothing renders them), so they never appear via edge traversal. On a full
  // build, discover them as standalone leaf nodes — never entry points, so
  // reachability/orphan semantics for the render graph are unaffected.
  let schemaUris: UriString[] = [];

  // An explicit entryPoints scope is built verbatim (e.g. a scoped LSP rebuild);
  // the default full build (`entryPoints === undefined`) also discovers
  // standalone schema nodes. Branching on the parameter directly lets the
  // compiler narrow it to a defined list below.
  if (entryPoints === undefined) {
    // A SINGLE directory sweep yields both the render entry points
    // (pages + layouts) and the standalone schema nodes, partitioned by
    // extension below — avoiding a second full-tree walk.
    const discovered = await findAllFiles(deps.fs, rootUri, ([uri]) => {
      // Layouts wrap all page content; pages are directly requested — both are
      // entry points.
      if (uri.endsWith('.liquid')) return isLayout(uri) || isPage(uri);
      if (uri.endsWith('.yml') || uri.endsWith('.yaml')) {
        return getFileType(uri) === PlatformOSFileType.CustomModelType;
      }
      return false;
    });
    entryPoints = discovered.filter((uri) => uri.endsWith('.liquid'));
    schemaUris = discovered.filter((uri) => uri.endsWith('.yml') || uri.endsWith('.yaml'));
  }

  const graph: AppGraph = {
    entryPoints: [],
    modules: {},
    rootUri,
  };

  graph.entryPoints = entryPoints
    .map((uri) => getModule(graph, uri))
    .filter((x): x is AppModule => x !== undefined);

  await Promise.all(graph.entryPoints.map((entry) => traverseModule(entry, graph, deps, options)));

  if (schemaUris.length > 0) {
    await Promise.all(
      schemaUris.map((uri) => traverseModule(getSchemaModule(graph, uri), graph, deps, options)),
    );
  }

  return graph;
}
