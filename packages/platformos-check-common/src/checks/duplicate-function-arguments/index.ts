import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { LiquidNamedArgument, FunctionMarkup } from '@platformos/liquid-html-parser';
import { getPartialName, reportDuplicateArguments } from '../../liquid-doc/arguments';

export const DuplicateFunctionArguments: LiquidCheckDefinition = {
  meta: {
    code: 'DuplicateFunctionArguments',
    name: 'Duplicate Function Arguments',
    aliases: [],
    docs: {
      description:
        'This check ensures that no duplicate argument names are provided when invoking partial as a function.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/duplicate-function-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async FunctionMarkup(node: FunctionMarkup) {
        const partialName = getPartialName(node);

        if (!partialName) return;

        const encounteredArgNames = new Set<string>();
        const duplicateArgs: LiquidNamedArgument[] = [];

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
