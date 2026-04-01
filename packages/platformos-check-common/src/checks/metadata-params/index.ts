import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { DocumentsLocator, DocumentType } from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidNamedArgument, Position } from '@platformos/liquid-html-parser';
import { relative } from '../../path';
import { extractUndefinedVariables } from './extract-undefined-variables';

export const MetadataParamsCheck: LiquidCheckDefinition = {
  meta: {
    code: 'MetadataParamsCheck',
    name: 'Metadata Params Check',
    docs: {
      description:
        'Ensures that parameters referenced in the document exist in the doc tag or are inferred from undefined variables.',
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
        const undefinedVars = extractUndefinedVariables(source, globalObjectNames);
        const docRequiredNames = docDef.liquidDoc.parameters
          .filter((p) => p.required)
          .map((p) => p.name);
        requiredParams = docRequiredNames.filter((name) => undefinedVars.includes(name));
        allowedParams = docDef.liquidDoc.parameters.map((p) => p.name);
      } else {
        // No @doc — scan for undefined variables, treat all as required
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

        const undefinedVars = extractUndefinedVariables(source, globalObjectNames);
        if (undefinedVars.length === 0) return;

        requiredParams = undefinedVars;
        allowedParams = undefinedVars;
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
