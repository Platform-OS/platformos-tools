import { isLayout, isPage, isPartial, path, UriString } from '@platformos/platformos-check-common';
import {
  AssetModule,
  AppGraph,
  AppModule,
  GraphQLModule,
  LiquidModule,
  LiquidModuleKind,
  ModuleType,
  SchemaModule,
  SUPPORTED_ASSET_IMAGE_EXTENSIONS,
} from '../types';
import { extname } from '../utils';

/**
 * We're using a ModuleCache to prevent race conditions with traverse.
 *
 * e.g. if we have two modules that depend on the same 'assets/foo.js' file and
 * that they somehow depend on it before it gets traversed (and thus added to the
 * graphs' modules record), we want to avoid creating two different module objects
 * that represent the same file.
 *
 * We're using a WeakMap<AppGraph> to cache modules so that if the app graph
 * gets garbage collected, the module cache will also be garbage collected.
 *
 * This allows us to have a module cache without changing the API of the
 * AppGraph (no need for a `visited` property on modules, etc.)
 */
const ModuleCache: WeakMap<AppGraph, Map<string, AppModule>> = new WeakMap();

export function getModule(appGraph: AppGraph, uri: UriString): AppModule | undefined {
  const cache = getCache(appGraph);
  if (cache.has(uri)) {
    return cache.get(uri)!;
  }

  const relativePath = path.relative(uri, appGraph.rootUri);

  switch (true) {
    case isLayout(uri):
      return getLayoutModule(appGraph, uri);

    case isPage(uri):
      return getPageModule(appGraph, uri);

    case isPartial(uri):
      return getPartialModule(appGraph, path.basename(uri, '.liquid'));

    case relativePath.startsWith('assets') || relativePath.startsWith('modules'):
      // The full URI is already resolved on-disk here, so use it directly rather
      // than rebuilding a path from the basename.
      return getAssetModuleByUri(appGraph, uri);
  }
}

/** File extensions the graph treats as assets (the `asset_url` edge gate). */
const SUPPORTED_ASSET_EXTENSIONS = [
  ...SUPPORTED_ASSET_IMAGE_EXTENSIONS,
  'js',
  'css',
  'svg',
  'pdf',
  'woff',
  'woff2',
  'ttf',
  'eot',
];

/**
 * Whether `name` refers to a supported asset file (by extension). The gate for
 * creating an asset edge, preserving the graph's historical behavior of ignoring
 * an `asset_url`-family filter applied to a value that is not an asset file.
 */
export function isSupportedAssetFile(name: string): boolean {
  return SUPPORTED_ASSET_EXTENSIONS.includes(extname(name));
}

/**
 * Create (or fetch the cached) Asset module for an ALREADY-RESOLVED asset URI —
 * used for `asset_url`/`asset_img_url`/`inline_asset_content` targets whose URI is
 * resolved canonically by `DocumentsLocator` (`'asset'` type: `app/assets`, module
 * `public/assets`). A leaf node. Normalizes the URI — see
 * {@link getPartialModuleByUri} for why DocumentsLocator URIs must be normalized.
 */
export function getAssetModuleByUri(appGraph: AppGraph, uri: string): AssetModule {
  return module(appGraph, {
    type: ModuleType.Asset,
    kind: 'unused',
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
  });
}

export function getPartialModule(appGraph: AppGraph, partial: string): LiquidModule {
  const uri = path.join(appGraph.rootUri, 'app/views/partials', `${partial}.liquid`);
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Partial,
    uri: uri,
    dependencies: [],
    references: [],
  });
}

/**
 * Create (or fetch the cached) Liquid Partial module for an ALREADY-RESOLVED
 * full URI — used for `{% function %}` / `{% include %}` targets whose URI is
 * resolved canonically by `DocumentsLocator` (which handles lib paths, module
 * prefixes, and extensions). Unlike {@link getPartialModule}, it does not
 * reconstruct the path from a name. Commands/queries/lib helpers are all
 * `Partial` kind, consistent with check-common's file-type classification.
 */
export function getPartialModuleByUri(appGraph: AppGraph, uri: string): LiquidModule {
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Partial,
    // Normalize to forward slashes so module keys match the rest of the graph
    // (getPartialModule/getAssetModule build URIs via path.join, which
    // normalizes). DocumentsLocator returns `Utils.joinPath(...).toString()`
    // unnormalized, which on Windows keeps backslashes and breaks key/edge
    // matching against the normalized URIs everywhere else.
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
  });
}

/**
 * Create (or fetch the cached) GraphQL module for an already-resolved
 * `.graphql` URI — used for `{% graphql op = 'name' %}` targets resolved by
 * `DocumentsLocator`. A leaf node (no outgoing edges).
 */
export function getGraphQLModuleByUri(appGraph: AppGraph, uri: string): GraphQLModule {
  return module(appGraph, {
    type: ModuleType.GraphQL,
    kind: 'graphql',
    // Normalize to forward slashes — see getPartialModuleByUri.
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
    // Always present (empty = no table declared); populated during traversal.
    tables: [],
  });
}

/**
 * Create (or fetch the cached) Schema module for an already-resolved
 * `custom_model_type`/schema URI — discovered during a full `buildAppGraph`.
 * A leaf node; its `table` (the model `name:`) is populated during traversal.
 */
export function getSchemaModule(appGraph: AppGraph, uri: string): SchemaModule {
  return module(appGraph, {
    type: ModuleType.Schema,
    kind: 'schema',
    // Normalize to forward slashes — see getPartialModuleByUri.
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
  });
}

export function getLayoutModule(
  appGraph: AppGraph,
  layoutUri: string | false | undefined,
): LiquidModule | undefined {
  if (!layoutUri) return undefined;
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Layout,
    // Normalize so a layout discovered as an entry point keys identically to the
    // same file resolved as a frontmatter `layout:` edge target (which comes
    // through getLayoutModuleByUri, also normalized) — one node, never a split
    // identity. See getPartialModuleByUri for why DocumentsLocator/fs URIs must
    // be normalized.
    uri: path.normalize(layoutUri),
    dependencies: [],
    references: [],
  });
}

/**
 * Create (or fetch the cached) Layout module for an already-resolved layout URI
 * — used for the frontmatter `layout:` association edge, whose target is
 * resolved by `DocumentsLocator` (`'layout'` type: `app/views/layouts`, module
 * prefixes, `.html.liquid`/`.liquid`). Unlike {@link getLayoutModule} (which
 * takes a known on-disk entry-point URI), this normalizes the URI — see
 * {@link getPartialModuleByUri} for why DocumentsLocator URIs must be normalized.
 */
export function getLayoutModuleByUri(appGraph: AppGraph, uri: string): LiquidModule {
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Layout,
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
  });
}

export function getPageModule(appGraph: AppGraph, pageUri: string): LiquidModule {
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Page,
    // Normalize for the same node-identity reason as getLayoutModule / the other
    // factories (see getPartialModuleByUri).
    uri: path.normalize(pageUri),
    dependencies: [],
    references: [],
  });
}

function getCache(appGraph: AppGraph): Map<string, AppModule> {
  if (!ModuleCache.has(appGraph)) {
    ModuleCache.set(appGraph, new Map());
  }
  return ModuleCache.get(appGraph)!;
}

function module<T extends AppModule>(appGraph: AppGraph, mod: T): T {
  const cache = getCache(appGraph);
  if (!cache.has(mod.uri)) {
    cache.set(mod.uri, mod);
  }
  return cache.get(mod.uri)! as T;
}

/**
 * Intern a fully-formed module into the graph's identity cache (dedup by URI),
 * returning the canonical instance. Deserialization uses this to SEED the cache
 * from a persisted graph, so that a subsequent incremental update
 * (`applyFileChange`) resolves its targets to the SAME module objects the loaded
 * graph holds — without it, the factories would mint fresh duplicates on a cache
 * miss and edges would bind to the wrong nodes. See {@link ModuleCache}.
 */
export function internModule<T extends AppModule>(appGraph: AppGraph, mod: T): T {
  return module(appGraph, mod);
}
