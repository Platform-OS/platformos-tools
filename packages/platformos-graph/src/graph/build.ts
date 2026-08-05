import { UriString } from '@platformos/platformos-check-common';
import {
  getFileType,
  PlatformOSFileType,
  SourceCodeType,
  sourceCodeTypeOf,
  walkAppSourceFiles,
} from '@platformos/platformos-common';
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

  // Table (schema / custom-model-type) files are platform nodes but are NOT
  // render-reachable — nothing renders them — so they never appear via edge traversal. On
  // a full build they are discovered as standalone leaf nodes, never entry points, so
  // reachability/orphan semantics for the render graph are unaffected.
  let schemaUris: UriString[] = [];

  // An explicit entryPoints scope is built verbatim (e.g. a scoped LSP rebuild); the
  // default full build (`entryPoints === undefined`) also discovers standalone Table
  // nodes. Branching on the parameter directly lets the compiler narrow it below.
  if (entryPoints === undefined) {
    // ONE sweep yields both populations, partitioned by SourceCodeType below, so the
    // tree is walked once. `walkAppSourceFiles` is anchored on APP_SOURCE_SUBTREES: the
    // walk it replaces started at the root and skipped directories by NAME, which both
    // dropped `app/views/pages/vendor/**` (a live site section — 137 files on one real
    // project) and admitted `tmp/app/views/partials/x.liquid`.
    const discovered = await walkAppSourceFiles(deps.fs, rootUri, ([uri]) => {
      // Root-ANCHORED classification. The unanchored `getFileType(uri)` this used to call
      // matched a known directory anywhere in the path, so
      // `seed/post_import/app/migrations/x.liquid` classified as a Migration while being
      // correctly absent from the lint's app.
      const fileType = getFileType(uri, rootUri);

      // A GRAPH-domain restriction, not a second answer to "what is a source file":
      // Liquid is the only source that can reference another file, so a non-Liquid entry
      // point would have no edges to traverse. Which extensions ARE Liquid still comes
      // from platformos-common, never spelled here — which is also why the `.yml`/`.yaml`
      // tests that used to partition this sweep are gone: `.yaml` is not a platformOS
      // extension at all, so spelling it here promised coverage the platform never had.
      if (sourceCodeTypeOf(uri) === SourceCodeType.LiquidHtml) {
        // Layouts wrap all page content; pages are directly requested — both are entry points.
        return fileType === PlatformOSFileType.Layout || fileType === PlatformOSFileType.Page;
      }
      return fileType === PlatformOSFileType.Table;
    });

    entryPoints = discovered.filter((uri) => sourceCodeTypeOf(uri) === SourceCodeType.LiquidHtml);
    schemaUris = discovered.filter((uri) => sourceCodeTypeOf(uri) !== SourceCodeType.LiquidHtml);
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
