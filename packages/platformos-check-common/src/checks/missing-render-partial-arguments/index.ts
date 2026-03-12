import { RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  getLiquidDocParams,
  getPartialName,
  reportMissingArguments,
} from '../../liquid-doc/arguments';

export const MissingRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'MissingRenderPartialArguments',
    name: 'Missing Required Render Partial Arguments',
    aliases: ['MissingRenderPartialParams'],
    docs: {
      description:
        'This check ensures that all required @param arguments declared by a partial are provided at the call site.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async RenderMarkup(node: RenderMarkup) {
        const partialName = getPartialName(node);
        if (!partialName) return;

        const liquidDocParameters = await getLiquidDocParams(context, partialName);
        if (!liquidDocParameters) return;

        const providedNames = new Set(node.args.map((a) => a.name));
        const missingRequired = [...liquidDocParameters.values()].filter(
          (p) => p.required && !providedNames.has(p.name),
        );

        reportMissingArguments(context, node, missingRequired, partialName);
      },
    };
  },
};
