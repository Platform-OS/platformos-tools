import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { FunctionMarkup, LiquidHtmlNode, RenderMarkup } from '@platformos/liquid-html-parser';
import { callSiteTag } from '../utils';
import { inferredTargetParams } from '../../liquid-doc/target-params';

export const PartialCallArguments: LiquidCheckDefinition = {
  meta: {
    code: 'PartialCallArguments',
    aliases: ['MetadataParamsCheck'],
    name: 'Partial Call Arguments',
    docs: {
      description:
        "Ensures that all required arguments are passed at render/function call sites, and that no unknown arguments are passed, for partials that have NO {% doc %} block. Required vs optional is inferred from undefined variables in the partial source; variables used with | default are treated as optional. A missing argument at an {% include %} site is not an error — `include` runs the partial in the caller's scope, so the value resolves from there — and belongs to `ImplicitIncludeArguments`. Documented partials are owned by `MissingRenderPartialArguments` and `UnrecognizedRenderPartialArguments`.",
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/partial-call-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const validate = async (node: RenderMarkup | FunctionMarkup, ancestors: LiquidHtmlNode[]) => {
      const targetFile = 'value' in node.partial ? node.partial.value : node.partial.name;
      if (!targetFile) return;

      const tag = callSiteTag(node, ancestors);
      const params = await inferredTargetParams(context, tag, targetFile);
      if (!params) return;

      const { required, optional, inScope } = params;
      const allowedParams = [...required, ...optional, ...inScope];

      node.args
        .filter((arg) => !allowedParams.includes(arg.name))
        .forEach((arg) => {
          context.report({
            message: `Unknown parameter ${arg.name} passed to ${tag} call`,
            startIndex: arg.position.start,
            endIndex: arg.position.end,
          });
        });

      // `include` runs the partial in the CALLER'S scope, so a variable the target reads and
      // the call does not pass is not missing — it resolves from the caller, and nothing is
      // broken. What is left is an explicitness problem, which `ImplicitIncludeArguments`
      // reports as a warning. The unknown-ARGUMENT direction above is a real mistake
      // whichever tag was used, so it stays.
      if (tag === 'include') return;

      required
        .filter((param) => !node.args.find((arg) => arg.name === param))
        .forEach((param) => {
          context.report({
            message: `Required parameter ${param} must be passed to ${tag} call`,
            startIndex: node.position.start,
            endIndex: node.position.end,
          });
        });
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
