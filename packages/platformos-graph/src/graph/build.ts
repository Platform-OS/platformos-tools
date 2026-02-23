import {
  recursiveReadDirectory as findAllFiles,
  path,
  UriString,
} from '@platformos/platformos-check-common';
import { IDependencies, AppGraph, AppModule } from '../types';
import { augmentDependencies } from './augment';
import { getModule } from './module';
import { traverseModule } from './traverse';

export async function buildAppGraph(
  rootUri: UriString,
  ideps: IDependencies,
  entryPoints?: UriString[],
): Promise<AppGraph> {
  const deps = augmentDependencies(rootUri, ideps);

  entryPoints =
    entryPoints ??
    (await findAllFiles(deps.fs, rootUri, ([uri]) => {
      // Layouts are entry points — they wrap all page content.
      const isLayoutFile =
        (uri.startsWith(path.join(rootUri, 'app/views/layouts')) ||
          uri.startsWith(path.join(rootUri, 'views/layouts'))) &&
        uri.endsWith('.liquid');

      // Pages are also entry points — they are directly requested.
      const isPageFile =
        (uri.startsWith(path.join(rootUri, 'app/views/pages')) ||
          uri.startsWith(path.join(rootUri, 'views/pages'))) &&
        uri.endsWith('.liquid');

      return isLayoutFile || isPageFile;
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

  return graph;
}
