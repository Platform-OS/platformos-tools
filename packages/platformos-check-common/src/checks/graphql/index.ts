import { GraphQLCheckDefinition, Severity, SourceCodeType } from '../../types';
import { parse } from 'graphql/language';
import { buildSchema, validate } from 'graphql';

function lineToRange(text: string, line: number): [number, number] {
  const lines = text.split(/\r?\n/);

  if (line < 1 || line > lines.length) {
    return [0, text.length];
  }

  let start = 0;
  for (let i = 0; i < line - 1; i++) {
    start += lines[i].length + 1;
  }

  const end = start + lines[line - 1].length;
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

      const document = parse(content);
      const errors = validate(graphQLSchema, document);

      errors.forEach((error) => {
        const [start, end] = lineToRange(content, error.locations?.[0].line ?? 0);
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
