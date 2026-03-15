import { LiquidHtmlNode, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, SchemaProp, Severity, SourceCodeType } from '../../types';
import {
  DocumentsLocator,
  DocumentType,
  loadSearchPaths,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';

function getTagName(ancestors: LiquidHtmlNode[]): DocumentType {
  const parent = ancestors.at(-1);
  if (parent?.type === NodeTypes.LiquidTag && parent.name === NamedTags.theme_render_rc) {
    return 'theme_render_rc';
  }
  return 'render';
}

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
    const rootUri = URI.parse(context.config.rootUri);
    let searchPathsPromise: Promise<string[] | null> | undefined;

    function getSearchPaths(): Promise<string[] | null> {
      searchPathsPromise ??= loadSearchPaths(context.fs, rootUri);
      return searchPathsPromise;
    }

    async function reportIfMissing(
      docType: DocumentType,
      name: string,
      position: LiquidHtmlNode['position'],
    ) {
      const searchPaths = docType === 'theme_render_rc' ? await getSearchPaths() : null;
      const location = await locator.locate(rootUri, docType, name, searchPaths);
      if (!location) {
        context.report({
          message: `'${name}' does not exist`,
          startIndex: position.start,
          endIndex: position.end,
        });
      }
    }

    return {
      async RenderMarkup(node, ancestors) {
        if (node.partial.type !== NodeTypes.VariableLookup) {
          await reportIfMissing(getTagName(ancestors), node.partial.value, node.partial.position);
        }
      },

      async FunctionMarkup(node) {
        if (node.partial.type !== NodeTypes.VariableLookup) {
          await reportIfMissing('function', node.partial.value, node.partial.position);
        }
      },

      async GraphQLMarkup(node) {
        if (node.graphql.type !== NodeTypes.VariableLookup) {
          await reportIfMissing('graphql', node.graphql.value, node.graphql.position);
        }
      },
    };
  },
};
