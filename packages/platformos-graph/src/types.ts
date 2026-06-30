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

export type AppModule = LiquidModule | AssetModule | GraphQLModule | SchemaModule;

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

/**
 * A Liquid file's own structural declarations — a by-product of the parse the
 * graph already does (TASK-9.3), so consumers need not re-parse the file.
 *
 * The usage arrays are ALWAYS present (sorted, de-duplicated): an empty array
 * means "the file uses none", since the whole AST is analyzed — never "not
 * extracted". The routing facts (`slug`/`layout`/`method`) are optional: an
 * absent one means "not applicable / not declared" (e.g. a partial has no slug).
 * `doc_params` lands in a later phase and will appear here when it does.
 */
export interface ModuleStructural {
  /** Partial names rendered via `{% render %}` / `{% include %}` (the literal target names). */
  renders_used: string[];
  /** Operation names invoked via `{% graphql %}` (the literal target names). */
  graphql_queries_used: string[];
  /** Liquid filter names used anywhere in the file. */
  filters_used: string[];
  /** Liquid tag names used anywhere in the file. */
  tags_used: string[];
  /** Translation keys referenced via the `t` / `translate` filter. */
  translation_keys: string[];
  /** `@param` names declared in the file's `{% doc %}` block. */
  doc_params: string[];
  /**
   * Effective URL slug: the frontmatter `slug` override if declared, else
   * derived from the page's path. Present for page files only.
   */
  slug?: string;
  /** Declared wrapper layout (frontmatter `layout`), when declared. */
  layout?: string;
  /** Declared HTTP method (frontmatter `method`), when declared. */
  method?: string;
}

export interface LiquidModule extends IAppModule<ModuleType.Liquid> {
  kind: LiquidModuleKind;
  /**
   * The file's own structural declarations (TASK-9.3), populated during a full
   * `buildAppGraph`. Absent when the file declares none of the surfaced facts.
   */
  structural?: ModuleStructural;
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
  /**
   * The platformOS model table this operation targets (from its `table` filter),
   * when it declares one. Populated during `buildAppGraph` traversal; absent for
   * operations with no table filter or that were never resolved on disk.
   */
  table?: string;
}

/**
 * A custom model type / schema file (`custom_model_types`/`model_schemas`/
 * `schema` dirs — `PlatformOSFileType.CustomModelType`). A platform primitive,
 * modeled as a neutral graph node. A leaf node — schema files have no outgoing
 * platformOS dependencies — and not render-reachable, so it is discovered and
 * added explicitly during a full `buildAppGraph` (never an entry point).
 *
 * NOTE (ADR 004): this is a neutral platform fact. The commands/queries
 * convention and resource/CRUD completeness that build ON schemas are NOT
 * modeled here — they live in the convention overlay (TASK-9.7).
 */
export interface SchemaModule extends IAppModule<ModuleType.Schema> {
  kind: 'schema';
  /**
   * The model table name (the schema's top-level `name:`), when declared. Named
   * `table` to align with {@link GraphQLModule.table} so a consumer can join a
   * GraphQL op to its schema. Absent when the file declares no `name:` or could
   * not be parsed.
   */
  table?: string;
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
  Schema = 'Schema',
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
