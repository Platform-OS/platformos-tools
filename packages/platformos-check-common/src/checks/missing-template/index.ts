import {
  LiquidTag,
  LiquidTagNamed,
  NamedTags,
  NodeTypes,
  Position,
} from '@platformos/liquid-html-parser';
import { minimatch } from 'minimatch';
import {
  LiquidCheckDefinition,
  RelativePath,
  SchemaProp,
  Severity,
  SourceCodeType,
} from '../../types';
import { doesFileExist } from '../../utils/file-utils';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

const schema = {
  ignoreMissing: SchemaProp.array(SchemaProp.string(), []),
};

export const MissingTemplate: LiquidCheckDefinition<typeof schema> = {
  meta: {
    code: 'MissingTemplate',
    name: 'Avoid rendering missing templates',
    docs: {
      description: 'Reports missing partial liquid file',
      recommended: true,
      url: 'https://shopify.dev/docs/storefronts/themes/tools/theme-check/checks/missing-template',
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
        if (node.snippet.type === NodeTypes.VariableLookup) return;

        const snippet = node.snippet;
        const location = await locator.locate(
          URI.parse(context.config.rootUri),
          'render',
          snippet.value,
        );

        if (!location) {
          context.report({
            message: `'${snippet.value}' does not exist`,
            startIndex: node.snippet.position.start,
            endIndex: node.snippet.position.end,
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
