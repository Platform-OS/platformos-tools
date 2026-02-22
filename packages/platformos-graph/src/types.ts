import {
  JSONSourceCode,
  LiquidSourceCode,
  Dependencies as CheckDependencies,
  UriString,
  Reference,
  Location,
  Range,
  GraphQLSourceCode,
  YAMLSourceCode,
} from '@platformos/platformos-check-common';

export interface IDependencies {
  fs: CheckDependencies['fs'];

  /** Optional perf improvement if you somehow have access to pre-computed source code info */
  getSourceCode?: (uri: UriString) => Promise<FileSourceCode>;

  /** A way to link <custom-element> to its window.customElements.define statement */
  getWebComponentDefinitionReference: (
    customElementName: string,
  ) => { assetName: string; range: Range } | undefined;
}

export type Dependencies = Required<IDependencies>;

export type AugmentedDependencies = Dependencies;

export interface AppGraph {
  rootUri: UriString;
  entryPoints: AppModule[];
  modules: Record<UriString, AppModule>;
}

export type AppModule = LiquidModule | AssetModule;

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

export interface SerializableEdge {
  source: Location;
  target: Location;
}

export type SerializableNode = Pick<AppModule, 'uri' | 'type' | 'kind' | 'exists'>;

export interface LiquidModule extends IAppModule<ModuleType.Liquid> {
  kind: LiquidModuleKind;
}

export interface AssetModule extends IAppModule<ModuleType.Asset> {
  kind: 'unused';
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

export { Reference, Range, Location };

export type Void = void | Void[];

export type WebComponentMap = Map<WebComponentName, WebComponentDefinition>;
export type WebComponentName = string;
export type WebComponentDefinition = {
  assetName: string; // Relative path to the asset file
  range: [number, number]; // Start and end positions in the file
};
