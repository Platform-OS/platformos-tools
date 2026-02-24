import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, SchemaProp, Severity, SourceCodeType } from '../../types';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

const schema = {
  ignoreMissing: SchemaProp.array(SchemaProp.string(), []),
};

export const MissingPartial: LiquidCheckDefinition<typeof schema> = {
  meta: {
    code: 'MissingPartial',
    name: 'Avoid rendering missing partials',
    docs: {
      description: 'Reports missing partial liquid file',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-partial',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema,
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);

    return {
      async RenderMarkup(node) {
        if (node.partial.type === NodeTypes.VariableLookup) return;

        const partial = node.partial;
        const location = await locator.locate(
          URI.parse(context.config.rootUri),
          'render',
          partial.value,
        );

        if (!location) {
          context.report({
            message: `'${partial.value}' does not exist`,
            startIndex: node.partial.position.start,
            endIndex: node.partial.position.end,
          });
        }
      },

      async FunctionMarkup(node) {
        if (node.partial.type === NodeTypes.VariableLookup) return;

        const partial = node.partial;
        const location = await locator.locate(
          URI.parse(context.config.rootUri),
          'function',
          partial.value,
        );

        if (!location) {
          context.report({
            message: `'${partial.value}' does not exist`,
            startIndex: node.partial.position.start,
            endIndex: node.partial.position.end,
          });
        }
      },

      async GraphQLMarkup(node) {
        if (node.graphql.type === NodeTypes.VariableLookup) return;

        const graphql = node.graphql;
        const location = await locator.locate(
          URI.parse(context.config.rootUri),
          'graphql',
          graphql.value,
        );

        if (!location) {
          context.report({
            message: `'${graphql.value}' does not exist`,
            startIndex: node.graphql.position.start,
            endIndex: node.graphql.position.end,
          });
        }
      },
    };
  },
};
