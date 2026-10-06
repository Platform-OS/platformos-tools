import { LiquidHtmlNode, LiquidTag } from '@platformos/liquid-html-parser';
import { parseGraphql } from '@platformos/platformos-common';
import { validate } from 'graphql';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { buildGraphQLSchema } from '../../utils/graphql-schema';
import { isLiquidTagGraphQL, isPlainTextBlock } from '../utils';

/** The body of an inline tag, with the file offset it starts at. */
interface InlineBody {
  source: string;
  startIndex: number;
}

/**
 * The body as the FILE spells it, so a reported index needs only this offset added.
 * Sliced from the source rather than joined from the children's `value`, which is
 * equal for an all-text body but carries no offset of its own.
 */
function inlineBody(node: LiquidTag & { children?: LiquidHtmlNode[] }): InlineBody | undefined {
  const children = node.children ?? [];
  if (children.length === 0 || !isPlainTextBlock(node)) return undefined;

  const startIndex = children[0].position.start;
  const endIndex = children[children.length - 1].position.end;

  return { source: node.source.slice(startIndex, endIndex), startIndex };
}

export const GraphQLInlineCheck: LiquidCheckDefinition = {
  meta: {
    code: 'GraphQLInlineCheck',
    name: 'GraphQL Inline Check',
    docs: {
      description:
        'Ensures that an inline {% graphql %} query or mutation is valid and matches the predefined schema.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/graphql-inline-check',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * `GraphQLCheck` validates the same thing, and cannot see this: `SourceCodeType.GraphQL`
     * is reached only from the `.graphql` extension, so an inline body travels inside a
     * LiquidHtml file. Reporting file-absolute indices is what keeps the offense on the
     * `.liquid` file — the engine derives every position from that file's own source.
     *
     * A body that does not parse is deliberately NOT reported. graphql-js and the platform's
     * own parser disagree in measured ways (`rejectedByThePlatform`), and which spellings the
     * platform accepts inline has not been measured against a live instance.
     */
    const checkBody = async (node: LiquidTag) => {
      if (!isLiquidTagGraphQL(node)) return;

      // Not all-text means the body interpolates Liquid, so there is no GraphQL document to
      // hand over — the shape depends on values this check cannot know.
      const body = inlineBody(node);
      if (!body) return;

      const { document } = parseGraphql(body.source);
      if (!document) return;

      const sdl = await context.platformosDocset?.graphQL();
      if (!sdl) return;

      for (const error of validate(buildGraphQLSchema(sdl), document)) {
        const location = error.nodes?.[0]?.loc;

        context.report({
          message: error.message,
          startIndex: body.startIndex + (location?.start ?? 0),
          endIndex: body.startIndex + (location?.end ?? body.source.length),
        });
      }
    };

    return {
      LiquidTag: checkBody,
    };
  },
};
