import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { LiquidNamedArgument, RenderMarkup } from '@platformos/liquid-html-parser';
import { getPartialName, reportDuplicateArguments } from '../../liquid-doc/arguments';

export const DuplicateRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'DuplicateRenderPartialArguments',
    name: 'Duplicate Render Partial Arguments',
    aliases: ['DuplicateRenderPartialParams'],
    docs: {
      description:
        'This check ensures that no duplicate argument names are provided when rendering a partial.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/duplicate-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async RenderMarkup(node: RenderMarkup) {
        const partialName = getPartialName(node);

        if (!partialName) return;

        const encounteredArgNames = new Set<string>();
        const duplicateArgs: LiquidNamedArgument[] = [];

        if (node.alias?.value) {
          encounteredArgNames.add(node.alias.value);
        }

        for (const param of node.args) {
          if (encounteredArgNames.has(param.name)) {
            duplicateArgs.push(param);
          }

          encounteredArgNames.add(param.name);
        }

        reportDuplicateArguments(context, node, duplicateArgs, partialName);
      },
    };
  },
};
