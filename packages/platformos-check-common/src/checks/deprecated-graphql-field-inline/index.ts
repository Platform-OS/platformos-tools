import { LiquidTag } from '@platformos/liquid-html-parser';

import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { deprecationProblems } from '../../utils/graphql-deprecations';
import { inlineGraphQLDocument } from '../utils';

export const DeprecatedGraphQLFieldInline: LiquidCheckDefinition = {
  meta: {
    code: 'DeprecatedGraphQLFieldInline',
    name: 'Deprecated GraphQL Field Inline',
    docs: {
      description:
        'Reports an inline {% graphql %} query or mutation using a field, argument, enum value or input field the schema marks deprecated.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-graphql-field-inline',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * The inline half of `DeprecatedGraphQLField`, which cannot see this body:
     * `SourceCodeType.GraphQL` is reached only from the `.graphql` extension.
     *
     * A separate check rather than a branch of `GraphQLInlineCheck`, because severity is a
     * property of the check and these two are not the same severity — an invalid query fails
     * when executed, a deprecated one runs. Merging them would make every deprecation an
     * error, or every invalid inline query a warning.
     *
     * Measured 2026-10-06 over eight application trees: inline bodies carry 736 of the 2,094
     * deprecation findings in the corpus, and use a deprecated element at more than twice the
     * rate of `.graphql` files (61% of bodies against 29% of documents).
     */
    const checkBody = async (node: LiquidTag) => {
      const inline = await inlineGraphQLDocument(node, context.platformosDocset);
      if (!inline) return;

      for (const problem of deprecationProblems(inline.schema, inline.document)) {
        context.report({
          message: problem.message,
          startIndex: inline.startIndex + problem.startIndex,
          endIndex: inline.startIndex + problem.endIndex,
        });
      }
    };

    return {
      LiquidTag: checkBody,
    };
  },
};
