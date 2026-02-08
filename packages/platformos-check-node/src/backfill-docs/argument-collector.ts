import {
  NodeTypes,
  FunctionMarkup,
  RenderMarkup,
  LiquidNamedArgument,
} from '@platformos/liquid-html-parser';
import {
  Theme,
  SourceCodeType,
  visit,
  BasicParamTypes,
  inferArgumentType,
} from '@platformos/platformos-check-common';
import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import { PartialUsage, TagType, ArgumentInfo } from './types';

/**
 * Extract the partial name from a RenderMarkup or FunctionMarkup node.
 * Returns undefined if the partial path is dynamic (VariableLookup).
 */
function getPartialName(node: RenderMarkup | FunctionMarkup): string | undefined {
  if (node.type === NodeTypes.RenderMarkup) {
    if (node.snippet.type === NodeTypes.String) {
      return node.snippet.value;
    }
    return undefined;
  }

  if (node.type === NodeTypes.FunctionMarkup) {
    if (node.partial.type === NodeTypes.String) {
      return node.partial.value;
    }
    return undefined;
  }

  return undefined;
}

/**
 * Merge a new argument into the existing usage map.
 * When the same argument has different types across calls, use 'object'.
 */
function mergeArgument(
  existingArgs: Map<string, ArgumentInfo>,
  arg: LiquidNamedArgument,
): void {
  const inferredType = inferArgumentType(arg.value);
  const existing = existingArgs.get(arg.name);

  if (existing) {
    existing.usageCount++;
    // If types differ, use 'object' as the fallback
    if (existing.inferredType !== inferredType) {
      existing.inferredType = BasicParamTypes.Object;
    }
  } else {
    existingArgs.set(arg.name, {
      name: arg.name,
      inferredType,
      usageCount: 1,
    });
  }
}

/**
 * Create a unique key for a partial that includes its tag type.
 * This is needed because 'function' and 'render' tags search different directories.
 */
function makeUsageKey(partialPath: string, tagType: TagType): string {
  return `${tagType}:${partialPath}`;
}

/**
 * Parse a usage key back into its components.
 */
function parseUsageKey(key: string): { partialPath: string; tagType: TagType } {
  const colonIndex = key.indexOf(':');
  return {
    tagType: key.slice(0, colonIndex) as TagType,
    partialPath: key.slice(colonIndex + 1),
  };
}

/**
 * Collect all partial usages from a theme by visiting function, render, and include tags.
 */
export async function collectPartialUsages(
  theme: Theme,
  verbose: boolean = false,
  log: (message: string) => void = console.log,
): Promise<Map<string, PartialUsage>> {
  const usageMap = new Map<string, PartialUsage>();

  for (const sourceCode of theme) {
    if (sourceCode.type !== SourceCodeType.LiquidHtml) continue;
    if (!isLiquidHtmlNode(sourceCode.ast)) continue;

    const ast = sourceCode.ast;

    await visit<SourceCodeType.LiquidHtml, void>(ast, {
      async LiquidTag(node) {
        // Handle function tags
        if (node.name === 'function' && node.markup && typeof node.markup === 'object') {
          const markup = node.markup as FunctionMarkup;
          if (markup.type !== NodeTypes.FunctionMarkup) return;

          const partialPath = getPartialName(markup);
          if (!partialPath) {
            if (verbose) {
              log(`  [skip] Dynamic function path in ${sourceCode.uri}`);
            }
            return;
          }

          const key = makeUsageKey(partialPath, 'function');
          let usage = usageMap.get(key);
          if (!usage) {
            usage = {
              partialPath,
              tagType: 'function',
              arguments: new Map(),
            };
            usageMap.set(key, usage);
          }

          for (const arg of markup.args) {
            if (arg.type === NodeTypes.NamedArgument) {
              mergeArgument(usage.arguments, arg);
            }
          }
        }

        // Handle render tags
        if (node.name === 'render' && node.markup && typeof node.markup === 'object') {
          const markup = node.markup as RenderMarkup;
          if (markup.type !== NodeTypes.RenderMarkup) return;

          const partialPath = getPartialName(markup);
          if (!partialPath) {
            if (verbose) {
              log(`  [skip] Dynamic render path in ${sourceCode.uri}`);
            }
            return;
          }

          const key = makeUsageKey(partialPath, 'render');
          let usage = usageMap.get(key);
          if (!usage) {
            usage = {
              partialPath,
              tagType: 'render',
              arguments: new Map(),
            };
            usageMap.set(key, usage);
          }

          for (const arg of markup.args) {
            if (arg.type === NodeTypes.NamedArgument) {
              mergeArgument(usage.arguments, arg);
            }
          }
        }

        // Handle include tags (same markup type as render)
        if (node.name === 'include' && node.markup && typeof node.markup === 'object') {
          const markup = node.markup as RenderMarkup;
          if (markup.type !== NodeTypes.RenderMarkup) return;

          const partialPath = getPartialName(markup);
          if (!partialPath) {
            if (verbose) {
              log(`  [skip] Dynamic include path in ${sourceCode.uri}`);
            }
            return;
          }

          const key = makeUsageKey(partialPath, 'include');
          let usage = usageMap.get(key);
          if (!usage) {
            usage = {
              partialPath,
              tagType: 'include',
              arguments: new Map(),
            };
            usageMap.set(key, usage);
          }

          for (const arg of markup.args) {
            if (arg.type === NodeTypes.NamedArgument) {
              mergeArgument(usage.arguments, arg);
            }
          }
        }
      },
    });
  }

  return usageMap;
}
