import {
  recursiveReadDirectory as findAllFiles,
  getFileType,
  isLayout,
  isPage,
  path,
  PlatformOSFileType,
  UriString,
} from '@platformos/platformos-check-common';
import { IDependencies, AppGraph, AppModule } from '../types';
import { augmentDependencies } from './augment';
import { getModule, getSchemaModule } from './module';
import { traverseModule } from './traverse';

export async function buildAppGraph(
  rootUri: UriString,
  ideps: IDependencies,
  entryPoints?: UriString[],
): Promise<AppGraph> {
  const deps = augmentDependencies(rootUri, ideps);

  // An explicit entryPoints scope is built verbatim (e.g. a scoped LSP rebuild);
  // the default full build also discovers standalone schema nodes below.
  const isFullBuild = entryPoints === undefined;

  entryPoints =
    entryPoints ??
    (await findAllFiles(deps.fs, rootUri, ([uri]) => {
      if (!uri.endsWith('.liquid')) return false;
      // Layouts are entry points — they wrap all page content.
      // Pages are also entry points — they are directly requested.
      return isLayout(uri) || isPage(uri);
    }));

  const graph: AppGraph = {
    entryPoints: [],
    modules: {},
    rootUri,
  };

  graph.entryPoints = entryPoints
    .map((uri) => getModule(graph, uri))
    .filter((x): x is AppModule => x !== undefined);

  await Promise.all(graph.entryPoints.map((entry) => traverseModule(entry, graph, deps)));

  // Schema/custom-model-type files are platform nodes but are NOT render-reachable
  // (nothing renders them), so they never appear via edge traversal. On a full
  // build, discover and add them as standalone leaf nodes — never entry points,
  // so reachability/orphan semantics for the render graph are unaffected.
  if (isFullBuild) {
    const schemaUris = await findAllFiles(
      deps.fs,
      rootUri,
      ([uri]) =>
        (uri.endsWith('.yml') || uri.endsWith('.yaml')) &&
        getFileType(uri) === PlatformOSFileType.CustomModelType,
    );
    await Promise.all(
      schemaUris.map((uri) => traverseModule(getSchemaModule(graph, uri), graph, deps)),
    );
  }

  return graph;
}
