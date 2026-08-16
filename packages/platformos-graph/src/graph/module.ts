import { path, UriString } from '@platformos/platformos-check-common';
import { getFileType, nameToPaths, PlatformOSFileType } from '@platformos/platformos-common';
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

  // One anchored classification, not four unanchored ones: a file's type is its
  // position relative to the project root, and the graph has that root.
  switch (getFileType(uri, appGraph.rootUri)) {
    case PlatformOSFileType.Layout:
      return getLayoutModule(appGraph, uri);

    case PlatformOSFileType.Page:
      return getPageModule(appGraph, uri);

    case PlatformOSFileType.Partial:
      // The URI is already resolved, so it is used as-is. Reducing it to a
      // `basename` and rebuilding a path from that loses any subdirectory and any
      // module prefix — `app/views/partials/ui/card.liquid` came back as
      // `app/views/partials/card.liquid`, a node for a file that need not exist,
      // and `app/lib/can/x.liquid` was split from the same file resolved as an
      // edge target (which comes through getPartialModuleByUri).
      return getPartialModuleByUri(appGraph, uri);

    case PlatformOSFileType.Asset:
      return getAssetModuleByUri(appGraph, uri);
  }
}

/**
 * Create (or fetch the cached) asset module for an already-resolved URI.
 *
 * Preferred over {@link getAssetModule} whenever the file is known, for the same
 * reason as {@link getPartialModuleByUri}: it does not reconstruct a path from a
 * name, so a nested or module asset keeps the location it actually has.
 *
 * Gated on {@link isSupportedAsset} HERE rather than at each call site, so a new
 * caller cannot forget the gate and mint an Asset node for a value that is not an
 * asset file.
 */
export function getAssetModuleByUri(appGraph: AppGraph, uri: string): AssetModule | undefined {
  if (!isSupportedAsset(uri)) return undefined;

  return module(appGraph, {
    type: ModuleType.Asset,
    kind: 'unused',
    // Normalize to forward slashes — see getPartialModuleByUri.
    uri: path.normalize(uri),
    dependencies: [],
    references: [],
  });
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
 * Whether `nameOrUri` refers to a supported asset file (by extension).
 *
 * The single gate for admitting an asset, whether the subject is a reference (the
 * string inside `{{ 'app.js' | asset_url }}`) or a resolved URI. It preserves the
 * graph's historical behavior of ignoring an `asset_url`-family filter applied to
 * a value that is not an asset file. Exported so the traversal can skip the
 * filesystem probe for a non-asset value BEFORE resolving it; the module
 * factories gate on it again, so neither layer depends on the other remembering.
 */
export function isSupportedAsset(nameOrUri: string): boolean {
  return SUPPORTED_ASSET_EXTENSIONS.includes(extname(nameOrUri));
}

/**
 * Create (or fetch the cached) asset module for an asset REFERENCE — the string
 * inside `{{ 'app.js' | asset_url }}`, which may carry a `modules/<name>/` prefix.
 *
 * Assets live under the same roots as every other file type: `app/assets/` or
 * `modules/<name>/{public,private}/assets/`. Those come from platformos-common, so the
 * graph resolves a reference to the same place the linter and the platform do.
 *
 * The FIRST candidate is used as the canonical location: this is sync and has no
 * filesystem, so it cannot tell which candidate exists. Prefer
 * {@link getAssetModuleByUri} — the traversal resolves through `DocumentsLocator`,
 * which can.
 */
export function getAssetModule(appGraph: AppGraph, asset: string): AssetModule | undefined {
  if (!isSupportedAsset(asset)) return undefined;

  const [canonical] = nameToPaths(PlatformOSFileType.Asset, asset);
  if (!canonical) return undefined;

  return module(appGraph, {
    type: ModuleType.Asset,
    kind: 'unused',
    uri: path.join(appGraph.rootUri, canonical),
    dependencies: [],
    references: [],
  });
}

/**
 * Create (or fetch the cached) Liquid Partial module for an ALREADY-RESOLVED
 * full URI — used for `{% render %}` / `{% include %}` / `{% function %}` /
 * `{% background %}` targets whose URI is resolved canonically by
 * `DocumentsLocator` (which handles lib paths, module prefixes, and extensions).
 * It keys the node by that URI verbatim (normalized), never reconstructing a path
 * from a name: partials have two search roots (`views/partials`, `lib`) and two
 * extensions, so a name-derived path is a guess, and guessing split a `lib/`
 * partial into two nodes. Commands/queries/lib helpers are all `Partial` kind,
 * consistent with check-common's file-type classification.
 */
export function getPartialModuleByUri(appGraph: AppGraph, uri: string): LiquidModule {
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Partial,
    // Normalize to forward slashes so module keys match the rest of the graph
    // (getAssetModule builds its URI via path.join, which normalizes).
    // DocumentsLocator returns `Utils.joinPath(...).toString()` unnormalized,
    // which on Windows keeps backslashes and breaks key/edge matching against the
    // normalized URIs everywhere else.
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
 * prefixes, `.html.liquid`/`.liquid`). Distinct from {@link getLayoutModule} only
 * in that the latter accepts the `string | false | undefined` a frontmatter read
 * yields; both normalize, so both key the same node.
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
