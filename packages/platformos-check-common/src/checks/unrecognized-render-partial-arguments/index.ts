import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidDocParameter } from '../../liquid-doc/liquidDoc';
import {
  getLiquidDocParams,
  getPartialName,
  reportUnknownArguments,
} from '../../liquid-doc/arguments';

export const UnrecognizedRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'UnrecognizedRenderPartialArguments',
    name: 'Unrecognized Render Partial Arguments',
    aliases: ['UnrecognizedRenderPartialParams'],
    docs: {
      description:
        'This check ensures that no unknown arguments are used when rendering a partial.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unrecognized-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    function reportUnknownAliases(
      node: RenderMarkup,
      liquidDocParameters: Map<string, LiquidDocParameter>,
      partialName: string,
    ) {
      const alias = node.alias;
      const variable = node.variable;

      if (alias && !liquidDocParameters.has(alias.value) && variable) {
        const startIndex = variable.position.start + 1;

        context.report({
          message: `Unknown argument '${alias.value}' in render tag for partial '${partialName}'.`,
          startIndex: startIndex,
          endIndex: alias.position.end,
          suggest: [
            {
              message: `Remove '${alias.value}'`,
              fix: (fixer: any) => {
                if (variable) {
                  return fixer.remove(variable.position.start, alias.position.end);
                }
              },
            },
          ],
        });
      }
    }

    return {
      async RenderMarkup(node: RenderMarkup) {
        const partialName = getPartialName(node);

        if (!partialName) return;

        const liquidDocParameters = await getLiquidDocParams(context, partialName);

        if (!liquidDocParameters) return;

        const unknownProvidedParams = node.args.filter((p) => !liquidDocParameters.has(p.name));
        reportUnknownAliases(node, liquidDocParameters, partialName);
        reportUnknownArguments(context, node, unknownProvidedParams, partialName);
      },
    };
  },
};
