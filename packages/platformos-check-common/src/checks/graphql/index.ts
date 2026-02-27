import { GraphQLCheckDefinition, Severity, SourceCodeType } from '../../types';
import { parse } from 'graphql/language';
import { buildSchema, GraphQLError, validate } from 'graphql';

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
    const validateContent = async (content: string) => {
      const graphQLSchemaString = await context.platformosDocset?.graphQL();
      if (!graphQLSchemaString) {
        return;
      }

      const graphQLSchema = buildSchema(graphQLSchemaString);

      let document;
      try {
        document = parse(content);
      } catch (e) {
        if (e instanceof GraphQLError) {
          const [start, end] = lineToRange(content, e.locations?.[0]?.line ?? 1);
          context.report({
            message: e.message,
            startIndex: start,
            endIndex: end,
          });
        }
        return;
      }

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
        await validateContent(node.ast.content);
      },
    };
  },
};
