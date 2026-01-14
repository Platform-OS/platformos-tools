import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { DocumentsLocator } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidNamedArgument, Position } from '@platformos/liquid-html-parser';
import { OperationDefinitionNode, parse, TypeNode } from 'graphql/language';

type ExtractedVariable = {
  name: string;
  required: boolean;
};

function isNonNullType(type: TypeNode): boolean {
  return type.kind === 'NonNullType';
}

export function extractVariables(content: string): ExtractedVariable[] | undefined {
  try {
    const ast = parse(content);
    const variables: ExtractedVariable[] = [];

    for (const definition of ast.definitions) {
      if (definition.kind === 'OperationDefinition') {
        const operation = definition as OperationDefinitionNode;

        if (operation.variableDefinitions) {
          for (const variableDef of operation.variableDefinitions) {
            const hasDefault = variableDef.defaultValue != null;
            variables.push({
              name: variableDef.variable.name.value,
              required: isNonNullType(variableDef.type) && !hasDefault,
            });
          }
        }
      }
    }

    return variables;
  } catch {
    return undefined;
  }
}

export const GraphQLVariablesCheck: LiquidCheckDefinition = {
  meta: {
    code: 'GraphQLVariablesCheck',
    name: 'GraphQL Variables Check',
    docs: {
      description:
        'Ensures that parameters referenced in the document exist in the GraphQL query or mutation.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);

    const validate = async (
      targetFile: string,
      args: LiquidNamedArgument[],
      position: Position,
    ) => {
      const locatedFile = await locator.locate(
        URI.parse(context.config.rootUri),
        'graphql',
        targetFile,
      );

      if (!locatedFile) {
        return;
      }
      let params = extractVariables(await context.fs.readFile(locatedFile));

      if (!params) {
        return;
      }
      args
        .filter((arg) => !params.find((param) => param.name == arg.name))
        .forEach((arg) => {
          context.report({
            message: `Unknown parameter ${arg.name} passed to GraphQL call`,
            startIndex: arg.position.start,
            endIndex: arg.position.end,
          });
        });

      params
        .filter((param) => param.required && !args.find((arg) => arg.name === param.name))
        .forEach((param) => {
          context.report({
            message: `Required parameter ${param.name} must be passed to GraphQL call`,
            startIndex: position.start,
            endIndex: position.end,
          });
        });
    };

    return {
      async GraphQLMarkup(node) {
        const targetFile = 'value' in node.graphql ? node.graphql.value : node.graphql.name;
        if (!targetFile) {
          return;
        }

        await validate(targetFile, node.args, node.position);
      },
    };
  },
};
