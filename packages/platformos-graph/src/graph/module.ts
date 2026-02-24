import { isLayout, isPage, isPartial, path, UriString } from '@platformos/platformos-check-common';
import {
  AssetModule,
  AppGraph,
  AppModule,
  LiquidModule,
  LiquidModuleKind,
  ModuleType,
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
      return getAssetModule(appGraph, path.basename(uri));

    case relativePath.startsWith('snippets'):
      return getPartialModule(appGraph, path.basename(uri, '.liquid'));
  }
}

export function getAssetModule(appGraph: AppGraph, asset: string): AssetModule | undefined {
  const extension = extname(asset);

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

  if (!SUPPORTED_ASSET_EXTENSIONS.includes(extension)) {
    return undefined;
  }

  return module(appGraph, {
    type: ModuleType.Asset,
    kind: 'unused',
    dependencies: [],
    references: [],
    uri: path.join(appGraph.rootUri, 'assets', asset),
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

export function getLayoutModule(
  appGraph: AppGraph,
  layoutUri: string | false | undefined,
): LiquidModule | undefined {
  if (!layoutUri) return undefined;
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Layout,
    uri: layoutUri,
    dependencies: [],
    references: [],
  });
}

export function getPageModule(appGraph: AppGraph, pageUri: string): LiquidModule {
  return module(appGraph, {
    type: ModuleType.Liquid,
    kind: LiquidModuleKind.Page,
    uri: pageUri,
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
