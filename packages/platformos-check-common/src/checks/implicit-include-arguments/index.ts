import { LiquidHtmlNode, RenderMarkup } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { callSiteTag } from '../utils';
import { inferredTargetParams } from '../../liquid-doc/target-params';

export const ImplicitIncludeArguments: LiquidCheckDefinition = {
  meta: {
    code: 'ImplicitIncludeArguments',
    name: 'Implicit Include Arguments',
    docs: {
      description:
        "This check reports a variable an {% include %}'d partial reads that the call site does not pass. `include` runs the partial in the caller's scope, so the value resolves from the caller and nothing is broken — but a reader of the call cannot see what the partial needs or where it comes from. Applies only to partials with NO {% doc %} block: a declared contract is owned by `MissingRenderPartialArguments`, which reports a missing required @param as an error at an include site too.",
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/implicit-include-arguments',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async RenderMarkup(node: RenderMarkup, ancestors: LiquidHtmlNode[]) {
        // `include` and `render` share this node type; only `include` shares scope, and only
        // for it is a missing argument something other than an error.
        if (callSiteTag(node, ancestors) !== 'include') return;

        const targetFile = 'value' in node.partial ? node.partial.value : node.partial.name;
        if (!targetFile) return;

        const params = await inferredTargetParams(context, 'include', targetFile);
        if (!params) return;

        const implicit = params.required.filter(
          (param) => !node.args.some((arg) => arg.name === param),
        );
        if (!implicit.length) return;

        // After the last thing the tag already names, so an inserted argument lands inside
        // the tag whichever form it takes: `{% include 'x' %}`, `{% include 'x', a: 1 %}`,
        // `{% include 'x' with y as z %}`, or a bare `include` line inside `{% liquid %}`.
        const insertAt = Math.max(
          node.partial.position.end,
          node.variable?.position.end ?? -1,
          node.alias?.position.end ?? -1,
          ...node.args.map((arg) => arg.position.end),
        );

        for (const param of implicit) {
          context.report({
            message: `Partial '${targetFile}' reads '${param}', which the include does not pass — it resolves from the caller's scope. Pass it explicitly.`,
            startIndex: node.position.start,
            endIndex: node.position.end,
            suggest: [
              {
                // The partial reads the name from the caller's scope, so passing it under
                // that same name hands over the same value — the meaning does not change,
                // only what the call site says about itself.
                message: `Pass '${param}' explicitly`,
                fix: (corrector) => corrector.insert(insertAt, `, ${param}: ${param}`),
              },
            ],
          });
        }
      },
    };
  },
};
