import { NodeTypes } from '@platformos/liquid-html-parser';
import { SourceCodeType, visit, Visitor } from '@platformos/platformos-check-common';
import {
  AugmentedDependencies,
  AppGraph,
  AppModule,
  LiquidModule,
  ModuleType,
  Range,
  Reference,
  Void,
} from '../types';
import { assertNever, exists, isString } from '../utils';
import { getAssetModule, getLayoutModule, getPartialModule } from './module';

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

  const visitor: Visitor<
    SourceCodeType.LiquidHtml,
    { target: AppModule; sourceRange: Range; targetRange?: Range }
  > = {
    // {{ 'theme.js' | asset_url }}
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
      };
    },

    // {% render 'partial' %}
    RenderMarkup: async (node, ancestors) => {
      const partial = node.partial;
      const tag = ancestors.at(-1)!;
      if (!isString(partial) && partial.type === NodeTypes.String) {
        return {
          target: getPartialModule(appGraph, partial.value),
          sourceRange: [tag.position.start, tag.position.end],
        };
      }
    },
  };

  const references = await visit(sourceCode.ast, visitor);

  for (const reference of references) {
    bind(module, reference.target, {
      sourceRange: reference.sourceRange,
      targetRange: reference.targetRange,
    });
  }

  const modules = unique(references.map((ref) => ref.target));
  const promises = modules.map((mod) => traverseModule(mod, appGraph, deps));

  return Promise.all(promises);
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
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
  }: {
    sourceRange?: Range; // a range in the source module that references the child
    targetRange?: Range; // a range in the child module that is being referenced
    type?: Reference['type']; // the type of dependency
  } = {},
): void {
  const dependency: Reference = {
    source: { uri: source.uri, range: sourceRange },
    target: { uri: target.uri, range: targetRange },
    type: type,
  };

  source.dependencies.push(dependency);
  target.references.push(dependency);
}
