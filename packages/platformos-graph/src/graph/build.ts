import { UriString } from '@platformos/platformos-check-common';
import {
  getFileType,
  PlatformOSFileType,
  SourceCodeType,
  sourceCodeTypeOf,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
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
    (await walkAppSourceFiles(deps.fs, rootUri, ([uri]) => {
      // A GRAPH-domain restriction, not a second answer to "what is a source
      // file": Liquid is the only source that can reference another file, so a
      // non-Liquid entry point would have no edges to traverse. Which extensions
      // ARE Liquid still comes from platformos-common, never spelled here.
      if (sourceCodeTypeOf(uri) !== SourceCodeType.LiquidHtml) return false;
      // Layouts are entry points — they wrap all page content.
      // Pages are also entry points — they are directly requested.
      const fileType = getFileType(uri, rootUri);
      return fileType === PlatformOSFileType.Layout || fileType === PlatformOSFileType.Page;
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
