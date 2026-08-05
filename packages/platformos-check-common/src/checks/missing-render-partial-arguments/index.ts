import { FunctionMarkup, LiquidHtmlNode, RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  getLiquidDocParams,
  getPartialName,
  reportMissingArguments,
} from '../../liquid-doc/arguments';
import { callSiteTag } from '../utils';

export const MissingRenderPartialArguments: LiquidCheckDefinition = {
  meta: {
    code: 'MissingRenderPartialArguments',
    name: 'Missing Required Render Partial Arguments',
    aliases: ['MissingRenderPartialParams'],
    docs: {
      description:
        'This check ensures that all required @param arguments declared by a partial are provided at the call site. It owns the partials that HAVE a {% doc %} block; `PartialCallArguments` owns the ones that do not. A {% doc %} block is a declared contract, so this applies to an {% include %} site as much as to a {% render %} one, even though `include` could have inherited the value from the caller.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/missing-render-partial-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const validate = async (node: RenderMarkup | FunctionMarkup, ancestors: LiquidHtmlNode[]) => {
      const partialName = getPartialName(node);
      if (!partialName) return;

      const liquidDocParameters = await getLiquidDocParams(context, partialName);
      if (!liquidDocParameters) return;

      const providedNames = new Set(node.args.map((a) => a.name));
      const missingRequired = [...liquidDocParameters.values()].filter(
        (p) => p.required && !providedNames.has(p.name),
      );

      reportMissingArguments(
        context,
        node,
        missingRequired,
        partialName,
        callSiteTag(node, ancestors),
      );
    };

    return {
      async RenderMarkup(node: RenderMarkup, ancestors: LiquidHtmlNode[]) {
        await validate(node, ancestors);
      },
      async FunctionMarkup(node: FunctionMarkup, ancestors: LiquidHtmlNode[]) {
        await validate(node, ancestors);
      },
    };
  },
};
