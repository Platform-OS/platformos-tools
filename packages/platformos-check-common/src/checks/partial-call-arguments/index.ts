import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { DocumentsLocator, DocumentType } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidNamedArgument, Position } from '@platformos/liquid-html-parser';
import { relative } from '../../path';
import { extractUndefinedVariables } from './extract-undefined-variables';

export const PartialCallArguments: LiquidCheckDefinition = {
  meta: {
    code: 'PartialCallArguments',
    aliases: ['MetadataParamsCheck'],
    name: 'Partial Call Arguments',
    docs: {
      description:
        'Ensures that all required arguments are passed at render/function call sites, and that no unknown arguments are passed. Required vs optional is determined from the {% doc %} block when present, or inferred from undefined variables in the partial source otherwise. Variables used with | default are treated as optional.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/partial-call-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs);

    const validate = async (
      nodeType: DocumentType,
      targetFile: string,
      args: LiquidNamedArgument[],
      position: Position,
    ) => {
      const locatedFile = await locator.locate(
        URI.parse(context.config.rootUri),
        nodeType,
        targetFile,
      );

      if (!locatedFile) {
        return;
      }

      const source = await context.fs.readFile(locatedFile);
      const relativePath = relative(locatedFile, context.config.rootUri);

      let requiredParams: string[];
      let allowedParams: string[];

      // Check for @doc tag first — if present, it's the complete param list
      const docDef = context.getDocDefinition
        ? await context.getDocDefinition(relativePath)
        : undefined;

      if (docDef?.liquidDoc?.parameters) {
        const globalObjectNames: string[] = [];
        if (context.platformosDocset) {
          const objects = await context.platformosDocset.objects();
          for (const obj of objects) {
            if (!obj.access || obj.access.global === true || obj.access.template.length > 0) {
              globalObjectNames.push(obj.name);
            }
          }
        }
        const { required: undefinedRequiredVars, optional: undefinedOptionalVars } =
          extractUndefinedVariables(source, globalObjectNames);
        const undefinedVars = [...undefinedRequiredVars, ...undefinedOptionalVars];
        const docRequiredNames = docDef.liquidDoc.parameters
          .filter((p) => p.required)
          .map((p) => p.name);
        requiredParams = docRequiredNames.filter((name) => undefinedVars.includes(name));
        allowedParams = docDef.liquidDoc.parameters.map((p) => p.name);
      } else {
        // No @doc — infer required vs optional from undefined variables in the source.
        // Variables used with `| default` are treated as optional.
        const globalObjectNames: string[] = [];
        if (context.platformosDocset) {
          const objects = await context.platformosDocset.objects();
          for (const obj of objects) {
            if (!obj.access || obj.access.global === true || obj.access.template.length > 0) {
              globalObjectNames.push(obj.name);
            }
          }
        }
        if (relativePath.includes('views/partials/') || relativePath.includes('/lib/')) {
          if (!globalObjectNames.includes('app')) {
            globalObjectNames.push('app');
          }
        }

        const { required: requiredVars, optional: optionalVars } = extractUndefinedVariables(
          source,
          globalObjectNames,
        );
        if (requiredVars.length === 0 && optionalVars.length === 0) return;

        requiredParams = requiredVars;
        allowedParams = [...requiredVars, ...optionalVars];
      }

      args
        .filter((arg) => !allowedParams.includes(arg.name))
        .forEach((arg) => {
          context.report({
            message: `Unknown parameter ${arg.name} passed to ${nodeType} call`,
            startIndex: arg.position.start,
            endIndex: arg.position.end,
          });
        });

      requiredParams
        .filter((param) => !args.find((arg) => arg.name === param))
        .forEach((param) => {
          context.report({
            message: `Required parameter ${param} must be passed to ${nodeType} call`,
            startIndex: position.start,
            endIndex: position.end,
          });
        });
    };

    return {
      async RenderMarkup(node) {
        const targetFile = 'value' in node.partial ? node.partial.value : node.partial.name;
        if (!targetFile) {
          return;
        }

        await validate('render', targetFile, node.args, node.position);
      },
      async FunctionMarkup(node) {
        const targetFile = 'value' in node.partial ? node.partial.value : node.partial.name;
        if (!targetFile) {
          return;
        }

        await validate('function', targetFile, node.args, node.position);
      },
    };
  },
};
