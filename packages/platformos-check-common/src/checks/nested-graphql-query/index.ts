import { NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isLoopLiquidTag } from '../utils';

export const NestedGraphQLQuery: LiquidCheckDefinition = {
  meta: {
    code: 'NestedGraphQLQuery',
    name: 'Prevent N+1 GraphQL queries in loops',
    docs: {
      description:
        'This check detects {% graphql %} tags placed inside loop tags ({% for %}, {% tablerow %}), which causes one database request per loop iteration (N+1 pattern).',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/nested-graphql-query',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidTag(node, ancestors) {
        if (node.name !== NamedTags.graphql) return;

        const ancestorTags = ancestors.filter((a) => a.type === NodeTypes.LiquidTag);

        const loopAncestor = ancestorTags.find(isLoopLiquidTag);

        if (!loopAncestor) return;

        // Skip if inside a background tag
        const inBackground = ancestorTags.some((a) => a.name === NamedTags.background);
        if (inBackground) return;

        // Skip if inside a cache block (caching mitigates the N+1 problem)
        const inCache = ancestorTags.some((a) => a.name === NamedTags.cache);
        if (inCache) return;

        let resultName = '';
        if (
          typeof node.markup !== 'string' &&
          (node.markup.type === NodeTypes.GraphQLMarkup ||
            node.markup.type === NodeTypes.GraphQLInlineMarkup)
        ) {
          resultName = node.markup.name ? ` result = '${node.markup.name}'` : '';
        }

        const graphqlStr = resultName ? `{% graphql${resultName} %}` : '{% graphql %}';

        const message = `N+1 pattern: ${graphqlStr} is inside a {% ${loopAncestor.name} %} loop. This executes at least one database request per iteration. Move the query before the loop and pass data as a variable.`;

        context.report({
          message,
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};
