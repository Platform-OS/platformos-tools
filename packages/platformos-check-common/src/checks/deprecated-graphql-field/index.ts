import { GraphQLDocumentNode } from '@platformos/platformos-common';

import { GraphQLCheckDefinition, Severity, SourceCodeType } from '../../types';
import { deprecationProblems } from '../../utils/graphql-deprecations';
import { buildGraphQLSchema } from '../../utils/graphql-schema';

export const DeprecatedGraphQLField: GraphQLCheckDefinition = {
  meta: {
    code: 'DeprecatedGraphQLField',
    name: 'Deprecated GraphQL Field',
    docs: {
      description:
        'Reports a GraphQL operation using a field, argument, enum value or input field the schema marks deprecated.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/deprecated-graphql-field',
      recommended: true,
    },
    type: SourceCodeType.GraphQL,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * The message is the schema's own `@deprecated(reason:)` text, so this check authors no
     * prose about the platform. `DeprecatedGraphQLFieldInline` reports the same thing for an
     * inline `{% graphql %}` body, which this check cannot see: `SourceCodeType.GraphQL` is
     * reached only from the `.graphql` extension.
     *
     * No suggestion is offered: a successor named in a reason is rarely a drop-in rename
     * (`models` to `records` changes argument names, filter input type and return shape),
     * so a corrector would produce a query that no longer validates.
     */
    const reportDeprecations = async ({ document }: GraphQLDocumentNode) => {
      // No parse means a syntax error, or a document the platform rejects. `GraphQLCheck`
      // owns that report, and a deprecation is not readable from a file with no parse.
      if (!document) return;

      const sdl = await context.platformosDocset?.graphQL();
      if (!sdl) return;

      for (const problem of deprecationProblems(buildGraphQLSchema(sdl), document)) {
        context.report(problem);
      }
    };

    return {
      async onCodePathEnd(node) {
        await reportDeprecations(node.ast);
      },
    };
  },
};
