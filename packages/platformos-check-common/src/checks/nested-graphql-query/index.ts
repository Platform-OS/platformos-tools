import {
  LiquidHtmlNode,
  NamedTags,
  NodeTypes,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isLoopLiquidTag } from '../utils';

const SKIP_IF_ANCESTOR_TAGS = [NamedTags.cache];

type GraphQLFound = {
  type: 'graphql';
  partialChain: string[];
};

type FunctionOrRenderFound = {
  type: 'function' | 'render';
  partialName: string;
};

type FoundNode = GraphQLFound | FunctionOrRenderFound;

function findNodesInAST(ast: LiquidHtmlNode[]): FoundNode[] {
  const results: FoundNode[] = [];
  const stack: LiquidHtmlNode[] = [...ast];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.type === NodeTypes.LiquidTag) {
      if (node.name === NamedTags.graphql) {
        results.push({ type: 'graphql', partialChain: [] });
      } else if (
        (node.name === NamedTags.function || node.name === NamedTags.render) &&
        typeof node.markup !== 'string' &&
        'partial' in node.markup &&
        node.markup.partial.type !== NodeTypes.VariableLookup
      ) {
        results.push({ type: node.name, partialName: node.markup.partial.value });
      }

      if ('children' in node && Array.isArray(node.children)) {
        stack.push(...node.children);
      }
    } else if ('children' in node && Array.isArray((node as any).children)) {
      stack.push(...(node as any).children);
    }
  }

  return results;
}

async function containsGraphQLTransitively(
  locator: DocumentsLocator,
  fs: { readFile(uri: string): Promise<string> },
  rootUri: URI,
  partialName: string,
  tagType: 'function' | 'render',
  visited: Set<string>,
): Promise<string[] | null> {
  if (visited.has(partialName)) return null;
  visited.add(partialName);

  const location = await locator.locate(rootUri, tagType, partialName);
  if (!location) return null;

  let source: string;
  try {
    source = await fs.readFile(location);
  } catch {
    return null;
  }

  let ast;
  try {
    ast = toLiquidHtmlAST(source);
  } catch {
    return null;
  }

  const nodes = findNodesInAST(ast.children);

  for (const found of nodes) {
    if (found.type === 'graphql') {
      return [partialName];
    }
  }

  for (const found of nodes) {
    if (found.type === 'function' || found.type === 'render') {
      const chain = await containsGraphQLTransitively(
        locator,
        fs,
        rootUri,
        found.partialName,
        found.type,
        visited,
      );
      if (chain) {
        return [partialName, ...chain];
      }
    }
  }

  return null;
}

export const NestedGraphQLQuery: LiquidCheckDefinition = {
  meta: {
    code: 'NestedGraphQLQuery',
    name: 'Prevent N+1 GraphQL queries in loops',
    docs: {
      description:
        'This check detects {% graphql %} tags placed inside loop tags ({% for %}, {% tablerow %}), which causes one database request per loop iteration (N+1 pattern). It also follows {% function %} and {% render %} calls transitively to detect indirect GraphQL queries.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/nested-graphql-query',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);
    const rootUri = URI.parse(context.config.rootUri);

    function isInsideLoopWithoutCacheOrBackground(ancestors: LiquidHtmlNode[]) {
      const ancestorTags = ancestors.filter((a) => a.type === NodeTypes.LiquidTag);
      const loopAncestor = ancestorTags.find(isLoopLiquidTag);
      if (!loopAncestor) return null;

      const inBackground = ancestorTags.some((a) => a.name === NamedTags.background);
      if (inBackground) return null;

      const shouldSkip = ancestorTags.some((a) =>
        SKIP_IF_ANCESTOR_TAGS.map((a) => a.toString()).includes(a.name),
      );
      if (shouldSkip) return null;

      return loopAncestor;
    }

    return {
      async LiquidTag(node, ancestors) {
        if (node.name === NamedTags.graphql) {
          const loopAncestor = isInsideLoopWithoutCacheOrBackground(ancestors);
          if (!loopAncestor) return;

          let resultName = '';
          if (
            typeof node.markup !== 'string' &&
            (node.markup.type === NodeTypes.GraphQLMarkup ||
              node.markup.type === NodeTypes.GraphQLInlineMarkup)
          ) {
            resultName = node.markup.name ? ` result = '${node.markup.name}'` : '';
          }

          const graphqlStr = resultName ? `{% graphql${resultName} %}` : '{% graphql %}';
          context.report({
            message: `N+1 pattern: ${graphqlStr} is inside a {% ${loopAncestor.name} %} loop. This executes at least one database request per iteration. Move the query before the loop and pass data as a variable.`,
            startIndex: node.position.start,
            endIndex: node.position.end,
          });
        } else if (node.name === NamedTags.function || node.name === NamedTags.render) {
          const loopAncestor = isInsideLoopWithoutCacheOrBackground(ancestors);
          if (!loopAncestor) return;

          if (
            typeof node.markup === 'string' ||
            !('partial' in node.markup) ||
            node.markup.partial.type === NodeTypes.VariableLookup
          ) {
            return;
          }

          const partialName = node.markup.partial.value;
          const visited = new Set<string>();
          const chain = await containsGraphQLTransitively(
            locator,
            context.fs,
            rootUri,
            partialName,
            node.name,
            visited,
          );

          if (chain) {
            const chainStr = chain.join(' → ');
            context.report({
              message: `N+1 pattern: {% ${node.name} '${partialName}' %} inside a {% ${loopAncestor.name} %} loop transitively calls a GraphQL query (${chainStr}). Move the query before the loop and pass data as a variable.`,
              startIndex: node.position.start,
              endIndex: node.position.end,
            });
          }
        }
      },
    };
  },
};
