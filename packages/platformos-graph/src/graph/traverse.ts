import { NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import { SourceCodeType, visit, Visitor } from '@platformos/platformos-check-common';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import {
  AugmentedDependencies,
  AppGraph,
  AppModule,
  LiquidModule,
  ModuleType,
  Range,
  Reference,
  ReferenceKind,
  Void,
} from '../types';
import { assertNever, exists, isString, unique } from '../utils';
import { getAssetModule, getGraphQLModuleByUri, getPartialModuleByUri } from './module';

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
      return; // Leaf node — GraphQL documents have no platformOS dependencies
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

  if (sourceCode.ast instanceof Error) return; // can't visit what you can't parse

  // Canonical target resolution (lib paths, module prefixes, extensions) is
  // owned by check-common's DocumentsLocator — never re-derived here.
  const documentsLocator = new DocumentsLocator(deps.fs);
  const rootUri = URI.parse(appGraph.rootUri);

  const visitor: Visitor<
    SourceCodeType.LiquidHtml,
    { target: AppModule; sourceRange: Range; targetRange?: Range; kind: ReferenceKind }
  > = {
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

    // <custom-element></custom-element>
    HtmlElement: async (node) => {
      if (node.name.length !== 1) return;
      if (node.name[0].type !== NodeTypes.TextNode) return;
      const nodeNameNode = node.name[0];
      const nodeName = nodeNameNode.value;
      if (!nodeName.includes('-')) return; // skip non-custom-elements

      const result = deps.getWebComponentDefinitionReference(nodeName);
      if (!result) return;
      const { assetName, range } = result;
      const assetModule = getAssetModule(appGraph, assetName);
      if (!assetModule) return;

      return {
        target: assetModule,
        sourceRange: [node.blockStartPosition.start, nodeNameNode.position.end],
        targetRange: range,
        kind: 'web_component',
      };
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
      };
    },
  };

  const references = await visit(sourceCode.ast, visitor);

  for (const reference of references) {
    bind(module, reference.target, {
      sourceRange: reference.sourceRange,
      targetRange: reference.targetRange,
      kind: reference.kind,
    });
  }

  const modules = unique(references.map((ref) => ref.target));
  const promises = modules.map((mod) => traverseModule(mod, appGraph, deps));

  return Promise.all(promises);
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
    targetRange,
    type = 'direct', // the type of dependency, can be 'direct' or 'indirect'
    kind, // the semantic Liquid construct that created the edge
  }: {
    sourceRange?: Range; // a range in the source module that references the child
    targetRange?: Range; // a range in the child module that is being referenced
    type?: Reference['type']; // the type of dependency
    kind?: ReferenceKind; // render | include | function | graphql | asset | web_component | layout
  } = {},
): void {
  const dependency: Reference = {
    source: { uri: source.uri, range: sourceRange },
    target: { uri: target.uri, range: targetRange },
    type: type,
    kind: kind,
  };

  source.dependencies.push(dependency);
  target.references.push(dependency);
}
