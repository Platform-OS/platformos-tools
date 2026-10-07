import { LiquidTag } from '@platformos/liquid-html-parser';
import { validate } from 'graphql';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { inlineGraphQLDocument } from '../utils';

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
     * The default rule set only, so this and `DeprecatedGraphQLFieldInline` stay disjoint:
     * a deprecated field is valid, and reporting it here would make it an error.
     */
    const checkBody = async (node: LiquidTag) => {
      const inline = await inlineGraphQLDocument(node, context.platformosDocset);
      if (!inline) return;

      for (const error of validate(inline.schema, inline.document)) {
        const location = error.nodes?.[0]?.loc;

        context.report({
          message: error.message,
          startIndex: inline.startIndex + (location?.start ?? 0),
          endIndex: inline.startIndex + (location?.end ?? inline.source.length),
        });
      }
    };

    return {
      LiquidTag: checkBody,
    };
  },
};
