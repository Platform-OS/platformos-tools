import {
  JSONSourceCode,
  LiquidSourceCode,
  Dependencies as CheckDependencies,
  UriString,
  Reference,
  ReferenceKind,
  Location,
  Range,
  GraphQLSourceCode,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';

export interface IDependencies {
  fs: CheckDependencies['fs'];

  /** Optional perf improvement if you somehow have access to pre-computed source code info */
  getSourceCode?: (uri: UriString) => Promise<FileSourceCode>;
}

export type Dependencies = Required<IDependencies>;

export type AugmentedDependencies = Dependencies;

export interface AppGraph {
  rootUri: UriString;
  entryPoints: AppModule[];
  modules: Record<UriString, AppModule>;
}

export type AppModule = LiquidModule | AssetModule | GraphQLModule;

export type FileSourceCode =
  | LiquidSourceCode
  | JSONSourceCode
  | GraphQLSourceCode
  | YAMLSourceCode
  | AssetSourceCode;

export interface SerializableGraph {
  rootUri: UriString;
  nodes: SerializableNode[];
  edges: SerializableEdge[];
}

// Serialized edges are the modules' dependency `Reference`s verbatim, so they
// carry `type` and `kind` in addition to `source`/`target`.
export type SerializableEdge = Reference;

export type SerializableNode = Pick<AppModule, 'uri' | 'type' | 'kind' | 'exists'>;

export interface LiquidModule extends IAppModule<ModuleType.Liquid> {
  kind: LiquidModuleKind;
}

export interface AssetModule extends IAppModule<ModuleType.Asset> {
  kind: 'unused';
}

/**
 * A `.graphql` operation file (referenced by `{% graphql op = 'name' %}`).
 * A leaf node — GraphQL documents have no outgoing platformOS dependencies —
 * so it is not traversed, only existence-checked (like {@link AssetModule}).
 */
export interface GraphQLModule extends IAppModule<ModuleType.GraphQL> {
  kind: 'graphql';
}

export interface IAppModule<T extends ModuleType> {
  /** Used as a discriminant in the AppModule union */
  type: T;

  /** Should be normalized. Used as key. */
  uri: UriString;

  /**
   * Outgoing references to other modules. e.g. {% render 'child' %} from parent
   *
   * The source URI of all dependencies is this module.
   */
  dependencies: Reference[];

  /**
   * Ingoing references from other modules. e.g. {% render 'child' %} in parent
   *
   * The target URI of all dependencies is this module.
   */
  references: Reference[];

  /**
   * Since you could have files that depend on files that don't exist,
   *
   * this property will be used to quickly identify those.
   */
  exists?: boolean;
}

export const enum ModuleType {
  Liquid = 'Liquid',
  Asset = 'Asset',
  GraphQL = 'GraphQL',
}

export const enum LiquidModuleKind {
  /** app/views/layouts/*.liquid files */
  Layout = 'layout',

  /** app/views/partials/*.liquid and app/lib/*.liquid files */
  Partial = 'partial',

  /** app/views/pages/*.liquid files */
  Page = 'page',
}

export const SUPPORTED_ASSET_IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'ico',
];

export interface AssetSourceCode {
  type: 'asset';
  uri: UriString;
  source: string;
  ast: any | Error;
}

export { Reference, ReferenceKind, Range, Location };

export type Void = void | Void[];
