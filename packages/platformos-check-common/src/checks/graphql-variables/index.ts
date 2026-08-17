import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  DocumentsLocator,
  GraphqlVariable,
  extractGraphqlVariables,
  isGraphqlDocument,
  parseGraphql,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidNamedArgument, Position } from '@platformos/liquid-html-parser';

export const GraphQLVariablesCheck: LiquidCheckDefinition = {
  meta: {
    code: 'GraphQLVariablesCheck',
    name: 'GraphQL Variables Check',
    docs: {
      description:
        'Ensures that parameters referenced in the document exist in the GraphQL query or mutation.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/graphql-variables-check',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs, context.app);

    /**
     * The variables a `.graphql` document declares, from the app's own copy of it.
     *
     * Through the `AppFile` rather than `fs.readFile` for two reasons: the app holds
     * the editor's unsaved buffer, which the disk does not, and it holds the PARSE, so
     * a query called from thirty pages is parsed once per run instead of thirty times.
     * A URI the app does not have — one resolved outside the project — still falls back
     * to reading and parsing it here.
     */
    const variablesOf = async (uri: string): Promise<GraphqlVariable[] | undefined> => {
      const file = context.app.get(uri);
      if (file) {
        await file.load();
        return isGraphqlDocument(file.ast) ? extractGraphqlVariables(file.ast) : undefined;
      }
      return extractGraphqlVariables(parseGraphql(await context.fs.readFile(uri)));
    };

    const validate = async (
      targetFile: string,
      args: LiquidNamedArgument[],
      position: Position,
    ) => {
      // `args` is a special parameter that splats a hash as all GraphQL variables
      // at runtime — we can't know which keys will be provided statically.
      if (args.some((arg) => arg.name === 'args')) return;

      const locatedFile = await locator.locate(
        URI.parse(context.config.rootUri),
        'graphql',
        targetFile,
      );

      if (!locatedFile) {
        return;
      }
      const params = await variablesOf(locatedFile);

      // A document we could not read declares nothing we know of — every argument at
      // this call site is neither proven wrong nor proven missing.
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
