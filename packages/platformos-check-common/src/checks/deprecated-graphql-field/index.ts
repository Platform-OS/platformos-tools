import { GraphQLDocumentNode } from '@platformos/platformos-common';
import { NoDeprecatedCustomRule, validate } from 'graphql';

import { GraphQLCheckDefinition, Severity, SourceCodeType } from '../../types';
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
     * `NoDeprecatedCustomRule` is deliberately absent from graphql-js's `specifiedRules`,
     * which is why `GraphQLCheck` — running the default set — reports none of this. It is
     * the only rule run here, so the two checks stay disjoint and neither can silence the
     * other. The message is the schema's own `@deprecated(reason:)` text, so this check
     * authors no prose about the platform.
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

      const errors = validate(buildGraphQLSchema(sdl), document, [NoDeprecatedCustomRule]);

      for (const error of errors) {
        // The NAME, not the node: a `Field`'s own range spans its alias and its whole
        // sub-selection, so a deprecated field with a large selection would be reported
        // across every line of it. Measured — `Field`, `Argument` and `ObjectField` all
        // carry the name separately, while an `EnumValue` is already just the value.
        // `?? 0` follows `MissingTable` for a node that carries no location at all.
        const node = error.nodes?.[0];
        const name = node && 'name' in node ? node.name : undefined;
        const location = name?.loc ?? node?.loc;

        context.report({
          message: error.message,
          startIndex: location?.start ?? 0,
          endIndex: location?.end ?? 0,
        });
      }
    };

    return {
      async onCodePathEnd(node) {
        await reportDeprecations(node.ast);
      },
    };
  },
};
