import { GraphQLDocumentNode } from '@platformos/platformos-common';
import { GraphQLCheckDefinition, Severity, SourceCodeType } from '../../types';
import { validate } from 'graphql';
import { buildGraphQLSchema } from '../../utils/graphql-schema';

export function lineToRange(text: string, line: number): [number, number] {
  const lines = text.split(/\r?\n/);
  const clampedLine = Math.max(1, Math.min(line, lines.length));

  let start = 0;
  for (let i = 0; i < clampedLine - 1; i++) {
    start += lines[i].length + 1;
  }

  const end = start + lines[clampedLine - 1].length;
  return [start, end];
}

export const GraphQLCheck: GraphQLCheckDefinition = {
  meta: {
    code: 'GraphQLCheck',
    name: 'GraphQL Check',
    docs: {
      description: 'Ensures that GraphQL query or mutation is valid and matches predefined schema.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.GraphQL,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    /**
     * The parse is the file's, not this check's: `App` parsed it once when the source
     * was read, and re-parsing here would be a second answer to what the same bytes
     * mean. A syntax error reaches us the same way — as a value on the node.
     */
    const validateDocument = async ({ content, document, syntaxError }: GraphQLDocumentNode) => {
      // A syntax error needs no schema — the parse already failed — so it is reported
      // before the schema is even asked for. Only `validate()` below compares the
      // document to something, and that is the half a missing schema silences.
      if (syntaxError) {
        const [start, end] = lineToRange(content, syntaxError.locations?.[0]?.line ?? 1);
        context.report({
          message: syntaxError.message,
          startIndex: start,
          endIndex: end,
        });
        return;
      }

      const graphQLSchemaString = await context.platformosDocset?.graphQL();
      if (!graphQLSchemaString || !document) {
        return;
      }

      const graphQLSchema = buildGraphQLSchema(graphQLSchemaString);
      const errors = validate(graphQLSchema, document);

      errors.forEach((error) => {
        const [start, end] = lineToRange(content, error.locations?.[0]?.line ?? 0);
        context.report({
          message: error.message,
          startIndex: start,
          endIndex: end,
        });
      });
    };

    return {
      async onCodePathEnd(node) {
        await validateDocument(node.ast);
      },
    };
  },
};
