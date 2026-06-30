import yaml from 'js-yaml';
import { LiquidNamedArgument, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import {
  extractDocDefinition,
  extractGraphqlTable,
  SourceCodeType,
  UriString,
  visit,
  Visitor,
} from '@platformos/platformos-check-common';
import {
  containsLiquid,
  DocumentsLocator,
  extractRelativePagePath,
  formatFromFilePath,
  slugFromFilePath,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import {
  AugmentedDependencies,
  AppGraph,
  AppModule,
  FileSourceCode,
  LiquidModule,
  ModuleStructural,
  ModuleType,
  Range,
  Reference,
  ReferenceKind,
  Void,
} from '../types';
import { assertNever, exists, isString, unique } from '../utils';
import {
  getAssetModule,
  getGraphQLModuleByUri,
  getLayoutModuleByUri,
  getPartialModuleByUri,
} from './module';

/** A resolved outgoing reference: the target graph node + its call-site range + kind (+ named-arg names). */
interface ResolvedReference {
  target: AppModule;
  sourceRange: Range;
  kind: ReferenceKind;
  /** Names of the named arguments at the call site, in source order; omitted when none. */
  args?: string[];
}

/** The dependency surface the reference resolver needs: just a filesystem (for DocumentsLocator). */
type ResolverDependencies = Pick<AugmentedDependencies, 'fs'>;

export async function traverseModule(
  module: AppModule,
  appGraph: AppGraph,
  deps: AugmentedDependencies,
): Promise<Void> {
  // If the module is already traversed, skip it
  if (appGraph.modules[module.uri]) {
    return;
  }

  // Signal to all users that the file is being traversed
  // This will prevent multiple traversals of the same file
  appGraph.modules[module.uri] = module;

  // Check if the module exists on disk
  module.exists = await exists(deps.fs, module.uri);

  // If the module doesn't exist, we can't traverse it
  if (!module.exists) {
    return;
  }

  switch (module.type) {
    case ModuleType.Liquid: {
      return traverseLiquidModule(module, appGraph, deps);
    }

    case ModuleType.Asset: {
      return; // Nothing to traverse in assets
    }

    case ModuleType.GraphQL: {
      // Leaf node — GraphQL documents have no platformOS dependencies. We do read
      // the source once to record the model `table` it targets (a neutral
      // platform fact), reusing check-common's GraphQL parser.
      const sourceCode = await deps.getSourceCode(module.uri);
      module.table = extractGraphqlTable(sourceCode.source);
      return;
    }

    case ModuleType.Schema: {
      // Leaf node — a custom model type / schema file. Read the source once to
      // record its model table name (the YAML `name:`), a neutral platform fact.
      const sourceCode = await deps.getSourceCode(module.uri);
      module.table = schemaTableName(sourceCode.source);
      return;
    }

    default: {
      return assertNever(module);
    }
  }
}

async function traverseLiquidModule(
  module: LiquidModule,
  appGraph: AppGraph,
  deps: AugmentedDependencies,
) {
  const sourceCode = await deps.getSourceCode(module.uri);

  // Surface the file's own structural declarations as a by-product of the parse
  // (TASK-9.3). Absent only when the file could not be parsed.
  module.structural = await extractStructural(sourceCode, module.uri);

  const references = await resolveLiquidReferences(appGraph, sourceCode, deps);

  for (const reference of references) {
    bind(module, reference.target, {
      sourceRange: reference.sourceRange,
      kind: reference.kind,
      args: reference.args,
    });
  }

  const modules = unique(references.map((ref) => ref.target));
  const promises = modules.map((mod) => traverseModule(mod, appGraph, deps));

  return Promise.all(promises);
}

/**
 * Resolve a single parsed Liquid file's outgoing references — the one place that
 * knows how each Liquid construct (`render`/`include`, `function`, `background`,
 * `graphql`, asset filters) maps to a target module + {@link ReferenceKind}.
 *
 * Both the full-project traversal ({@link traverseLiquidModule}) and the
 * standalone per-file primitive ({@link extractFileReferences}) go through this,
 * so resolution can never drift between "graph build" and "validate one buffer".
 *
 * Targets are produced via the module factories (which normalize URIs), so keys
 * match the rest of the graph on every platform. Unparseable input yields no
 * references rather than throwing.
 */
async function resolveLiquidReferences(
  appGraph: AppGraph,
  sourceCode: FileSourceCode,
  deps: ResolverDependencies,
): Promise<ResolvedReference[]> {
  if (sourceCode.ast instanceof Error) return []; // can't visit what you can't parse

  // Canonical target resolution (lib paths, module prefixes, extensions) is
  // owned by check-common's DocumentsLocator — never re-derived here.
  const documentsLocator = new DocumentsLocator(deps.fs);
  const rootUri = URI.parse(appGraph.rootUri);

  const visitor: Visitor<SourceCodeType.LiquidHtml, ResolvedReference> = {
    // {{ 'app.js' | asset_url }}
    // {{ 'image.png' | asset_img_url }}
    // {{ 'icon.svg' | inline_asset_content }}
    LiquidFilter: async (node, ancestors) => {
      if (['asset_url', 'asset_img_url', 'inline_asset_content'].includes(node.name)) {
        const parentNode = ancestors[ancestors.length - 1]!;
        if (parentNode.type !== NodeTypes.LiquidVariable) return;
        if (parentNode.expression.type !== NodeTypes.String) return;
        if (parentNode.filters[0] !== node) return;
        const asset = parentNode.expression.value;
        const assetModule = getAssetModule(appGraph, asset);
        if (!assetModule) return;
        return {
          target: assetModule,
          sourceRange: [parentNode.position.start, parentNode.position.end],
          kind: 'asset',
        };
      }
    },

    // {% render 'partial' %} / {% include 'partial' %}
    // Both resolve through DocumentsLocator (like function/graphql), so module
    // prefixes (`modules/<m>/...`), the lib search path, and `.liquid` /
    // `.html.liquid` extensions are handled uniformly — not hard-coded to
    // `app/views/partials`.
    RenderMarkup: async (node, ancestors) => {
      const partial = node.partial;
      const tag = ancestors.at(-1)!;
      if (!isStringLiteral(partial)) return; // dynamic target — skip
      const isInclude = tag.type === NodeTypes.LiquidTag && tag.name === NamedTags.include;
      const uri = await documentsLocator.locateOrDefault(
        rootUri,
        isInclude ? 'include' : 'render',
        partial.value,
      );
      if (!uri) return;
      return {
        target: getPartialModuleByUri(appGraph, uri),
        sourceRange: [tag.position.start, tag.position.end],
        kind: isInclude ? 'include' : 'render',
        args: argNames(node.args),
      };
    },

    // {% function result = 'queries/...' %} / {% function res = 'commands/...' %}
    FunctionMarkup: async (node, ancestors) => {
      const target = node.partial;
      const tag = ancestors.at(-1)!;
      if (!isStringLiteral(target)) return; // dynamic target — skip
      const uri = await documentsLocator.locateOrDefault(rootUri, 'function', target.value);
      if (!uri) return;
      return {
        target: getPartialModuleByUri(appGraph, uri),
        sourceRange: [tag.position.start, tag.position.end],
        kind: 'function',
        args: argNames(node.args),
      };
    },

    // {% background job_id = 'partial', ... %} (file-based form)
    // Runs a partial asynchronously; `node.partial` is the partial reference,
    // resolved against the same search paths as {% function %}. The inline form
    // ({% background %}...{% endbackground %}) parses to BackgroundInlineMarkup,
    // has no file target, and is intentionally not matched here.
    BackgroundMarkup: async (node, ancestors) => {
      const target = node.partial;
      const tag = ancestors.at(-1)!;
      if (!isStringLiteral(target)) return; // dynamic target — skip
      const uri = await documentsLocator.locateOrDefault(rootUri, 'function', target.value);
      if (!uri) return;
      return {
        target: getPartialModuleByUri(appGraph, uri),
        sourceRange: [tag.position.start, tag.position.end],
        kind: 'background',
        args: argNames(node.args),
      };
    },

    // {% graphql result = 'path/to/operation' %}
    // `node.name` is the RESULT variable; the operation-file path is `node.graphql`.
    GraphQLMarkup: async (node, ancestors) => {
      const op = node.graphql;
      const tag = ancestors.at(-1)!;
      if (!isStringLiteral(op)) return; // dynamic/inline — no static file
      const uri = await documentsLocator.locateOrDefault(rootUri, 'graphql', op.value);
      if (!uri) return;
      return {
        target: getGraphQLModuleByUri(appGraph, uri),
        sourceRange: [tag.position.start, tag.position.end],
        kind: 'graphql',
        args: argNames(node.args),
      };
    },

    // Frontmatter `layout: name` → page/email → its wrapper layout.
    // Resolved through DocumentsLocator (`'layout'`: app/views/layouts, module
    // prefixes, `.html.liquid`/`.liquid`). Only an EXPLICIT, static, non-empty
    // string layout produces an edge:
    //  - `layout: ''`        → explicitly no layout (no edge)
    //  - layout omitted      → no edge (we never synthesize the implicit default)
    //  - dynamic `{{ ... }}` → no edge (not statically resolvable)
    //  - non-string value    → no edge
    // The source range is the whole frontmatter block (tag-level granularity,
    // like the other edges).
    YAMLFrontmatter: async (node) => {
      const data = loadFrontmatter(node.body);
      if (!data) return; // malformed/empty frontmatter — nothing to resolve
      const layout = data.layout;
      if (typeof layout !== 'string' || layout === '' || containsLiquid(layout)) return;
      const uri = await documentsLocator.locateOrDefault(rootUri, 'layout', layout);
      if (!uri) return;
      return {
        target: getLayoutModuleByUri(appGraph, uri),
        sourceRange: [node.position.start, node.position.end],
        kind: 'layout',
      };
    },
  };

  return visit(sourceCode.ast, visitor);
}

/**
 * Extract one Liquid file's outgoing dependency references, resolved against the
 * project at `rootUri`, WITHOUT building the whole app graph.
 *
 * This is the per-file primitive for consumers that hold a single (possibly
 * in-flight, not-yet-on-disk) buffer — e.g. a `validate_code`-style tool that
 * parses the buffer with {@link toSourceCode} and wants the file's resolved
 * `render`/`include`/`function`/`background`/`graphql`/asset edges with their
 * canonical target URIs and {@link ReferenceKind}. Resolution uses the same
 * `DocumentsLocator`-backed logic as the full graph build, so a target's URI is
 * identical to the key it would have as a graph node.
 *
 * Notes for consumers:
 * - Targets are returned whether or not they exist on disk (resolution is
 *   path-based). To distinguish missing targets, `stat` `target.uri` via the
 *   same `fs`; unresolved/missing partials are also surfaced by the linter's
 *   `MissingPartial` check, so prefer that for diagnostics.
 * - Only statically resolvable references are returned; dynamic targets
 *   (`{% render some_var %}`) and inline forms are skipped.
 * - `sourceCode` is parsed by the caller (from the buffer, not disk); only `fs`
 *   is touched here, for target resolution.
 */
export async function extractFileReferences(
  rootUri: UriString,
  sourceUri: UriString,
  sourceCode: FileSourceCode,
  deps: ResolverDependencies,
): Promise<Reference[]> {
  // A throwaway graph so the URI-normalizing module factories can be reused; it
  // is never traversed and is discarded with this call.
  const scratchGraph: AppGraph = { rootUri, entryPoints: [], modules: {} };
  const references = await resolveLiquidReferences(scratchGraph, sourceCode, deps);

  return references.map((reference) => ({
    source: { uri: sourceUri, range: reference.sourceRange },
    target: { uri: reference.target.uri },
    type: 'direct' as const,
    kind: reference.kind,
    // Only carry `args` when the call site has named arguments (parity with bind).
    ...(reference.args && reference.args.length > 0 ? { args: reference.args } : {}),
  }));
}

/**
 * A render/function/graphql target that is a static string literal (e.g.
 * `{% render 'partial' %}`), narrowed to its `NodeTypes.String` member so the
 * `.value` is accessible. Dynamic targets (`{% render var %}`) return false and
 * are skipped — the graph only records statically resolvable edges.
 */
function isStringLiteral<T extends { type: NodeTypes }>(
  node: T,
): node is Extract<T, { type: NodeTypes.String }> {
  return !isString(node) && node.type === NodeTypes.String;
}

/**
 * Parse a YAML block (frontmatter body or a schema file) into an object, or
 * `undefined` for unparseable / non-object YAML. The single `js-yaml` entry
 * point shared by the layout-edge resolver, schema-table extraction, and
 * self-structural extraction — so there is one frontmatter/YAML parse path.
 */
function loadFrontmatter(body: string): Record<string, unknown> | undefined {
  let data: unknown;
  try {
    data = yaml.load(body);
  } catch {
    return undefined;
  }
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined;
}

/**
 * The model table name a schema/custom-model-type file declares — its top-level
 * YAML `name:`. Returns `undefined` for a missing/non-string `name` or
 * unparseable YAML.
 */
function schemaTableName(source: string): string | undefined {
  const name = loadFrontmatter(source)?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The YAMLFrontmatter body of a parsed Liquid file, if it has frontmatter. */
function frontmatterBody(sourceCode: FileSourceCode): string | undefined {
  if (sourceCode.type !== SourceCodeType.LiquidHtml) return undefined;
  const ast = sourceCode.ast;
  if (ast instanceof Error || ast.type !== NodeTypes.Document) return undefined;
  const node = ast.children.find((child) => child.type === NodeTypes.YAMLFrontmatter);
  return node?.type === NodeTypes.YAMLFrontmatter ? node.body : undefined;
}

/**
 * Extract a Liquid file's own structural declarations (TASK-9.3, phase A: page
 * routing facts) as a by-product of the already-parsed AST. Reuses the shared
 * `js-yaml` frontmatter parse and platformos-common's slug helpers — never a
 * second/bespoke parser.
 *
 * Usage facts (`renders_used` / `graphql_queries_used` / `filters_used` /
 * `tags_used` / `translation_keys`) come from one walk of the already-parsed
 * AST and are always present (sorted, de-duplicated; empty = none used). Routing
 * facts come from frontmatter:
 * - `slug`: the frontmatter `slug` override (verbatim, matching the RouteTable
 *   source of truth) else the path-derived slug — for page files only.
 * - `layout` / `method`: from frontmatter when declared.
 *
 * Returns `undefined` only when the file could not be parsed (no AST to analyze).
 */
async function extractStructural(
  sourceCode: FileSourceCode,
  uri: UriString,
): Promise<ModuleStructural | undefined> {
  if (sourceCode.ast instanceof Error) return undefined; // unparseable — nothing to analyze

  const renders = new Set<string>();
  const graphqlQueries = new Set<string>();
  const filters = new Set<string>();
  const tags = new Set<string>();
  const translationKeys = new Set<string>();

  await visit<SourceCodeType.LiquidHtml, void>(sourceCode.ast, {
    RenderMarkup: async (node) => {
      if (isStringLiteral(node.partial)) renders.add(node.partial.value);
    },
    GraphQLMarkup: async (node) => {
      if (isStringLiteral(node.graphql)) graphqlQueries.add(node.graphql.value);
    },
    LiquidFilter: async (node) => {
      filters.add(node.name);
    },
    LiquidTag: async (node) => {
      if (typeof node.name === 'string') tags.add(node.name);
    },
    // A translation-key usage is a string literal piped through `t`/`translate`,
    // e.g. `{{ 'greeting.hello' | t }}` — same detection as the translation check.
    LiquidVariable: async (node) => {
      if (
        node.expression.type === NodeTypes.String &&
        node.filters.some((filter) => filter.name === 't' || filter.name === 'translate')
      ) {
        translationKeys.add(node.expression.value);
      }
    },
  });

  // `{% doc %}` @param names — reuse check-common's liquid-doc extractor (no
  // second parser); preserve declaration order (the param signature order).
  const docDefinition = await extractDocDefinition(uri, sourceCode.ast);
  const docParams = (docDefinition.liquidDoc?.parameters ?? []).map((param) => param.name);

  const frontmatter = loadFrontmatterOf(sourceCode);
  const layout = typeof frontmatter?.layout === 'string' ? frontmatter.layout : undefined;
  const method = typeof frontmatter?.method === 'string' ? frontmatter.method : undefined;
  const slug = effectiveSlug(uri, frontmatter);

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

  return {
    renders_used: sorted(renders),
    graphql_queries_used: sorted(graphqlQueries),
    filters_used: sorted(filters),
    tags_used: sorted(tags),
    translation_keys: sorted(translationKeys),
    doc_params: docParams,
    ...(slug !== undefined ? { slug } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(method !== undefined ? { method } : {}),
  };
}

/** The parsed frontmatter object of a Liquid file, if it has frontmatter. */
function loadFrontmatterOf(sourceCode: FileSourceCode): Record<string, unknown> | undefined {
  const body = frontmatterBody(sourceCode);
  return body ? loadFrontmatter(body) : undefined;
}

/**
 * The effective URL slug for `uri`: the frontmatter `slug` override (coerced to
 * a string, matching RouteTable) when declared, else the slug derived from the
 * page path (reusing `extractRelativePagePath` + `slugFromFilePath`). Returns
 * `undefined` for non-page files with no `slug` override.
 */
function effectiveSlug(
  uri: UriString,
  frontmatter: Record<string, unknown> | undefined,
): string | undefined {
  if (frontmatter && frontmatter.slug !== undefined && frontmatter.slug !== null) {
    return String(frontmatter.slug);
  }
  const relativePath = extractRelativePagePath(uri);
  if (relativePath === null) return undefined;
  return slugFromFilePath(relativePath, formatFromFilePath(relativePath));
}

/**
 * The names of a call site's named arguments, in source order, or `undefined`
 * when there are none. Defensive against the parser's documented
 * completion-context case (a trailing incomplete argument may not be a
 * fully-typed `NamedArgument`): only `NamedArgument`s with a string name
 * contribute. Values are intentionally not captured — names are what
 * cross-checking against a partial's `@param` signature needs.
 */
function argNames(args: LiquidNamedArgument[]): string[] | undefined {
  const names = args
    .filter((arg) => arg.type === NodeTypes.NamedArgument && typeof arg.name === 'string')
    .map((arg) => arg.name);
  return names.length > 0 ? names : undefined;
}

/**
 * The bind method is the method that links two modules together.
 *
 * It adds the dependency to the source module's dependencies and the target module's references.
 *
 * This function mutates the source and target modules.
 */
export function bind(
  source: AppModule,
  target: AppModule,
  {
    sourceRange,
    type = 'direct', // the type of dependency, can be 'direct' or 'indirect'
    kind, // the semantic Liquid construct that created the edge
    args, // names of the named arguments at the call site (omitted when none)
  }: {
    sourceRange?: Range; // a range in the source module that references the child
    type?: Reference['type']; // the type of dependency
    kind?: ReferenceKind; // render | include | function | background | graphql | asset | layout
    args?: string[]; // named-argument names at the call site
  } = {},
): void {
  const dependency: Reference = {
    source: { uri: source.uri, range: sourceRange },
    target: { uri: target.uri },
    type: type,
    kind: kind,
    // Only carry `args` when the call site has named arguments, so argument-less
    // edges stay free of an empty field.
    ...(args && args.length > 0 ? { args } : {}),
  };

  source.dependencies.push(dependency);
  target.references.push(dependency);
}
