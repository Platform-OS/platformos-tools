import { LiquidDocParamNode } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { fileTypeSupportsLiquidDoc } from '../../liquid-doc/utils';
import { partialInputs } from '../../liquid-doc/partial-inputs';

export const RequiredDocParamWithDefault: LiquidCheckDefinition = {
  meta: {
    code: 'RequiredDocParamWithDefault',
    name: 'Required doc parameter with a default',
    docs: {
      description:
        'This check reports a parameter a partial declares as required in its `doc` tag and then reads through `| default`. Supplying the default is evidence the partial handles the missing value, so the declaration almost certainly meant `[param]` — and until it says so, every call site that omits the argument is reported for a parameter the partial demonstrably handles.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/required-doc-param-with-default',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    // `{% doc %}` applies to partials and to nothing else, so no other file can drift from one.
    if (!fileTypeSupportsLiquidDoc(context.fileType())) return {};

    const requiredParams: LiquidDocParamNode[] = [];

    return {
      async LiquidDocParamNode(node) {
        if (node.required) requiredParams.push(node);
      },

      async onCodePathEnd() {
        if (requiredParams.length === 0) return;

        // `selfDefaulted`, not `optional`: in `assign x = x | default: params.x` it is `x`
        // that the file defaults, while `params` is only what it falls back ON, and reading
        // a fallback source says nothing about whether the partial needs it passed.
        const { selfDefaulted } = await partialInputs(context);
        const defaulted = new Set(selfDefaulted);

        for (const node of requiredParams) {
          const name = node.paramName.value;
          if (!defaulted.has(name)) continue;

          context.report({
            message: `The parameter '${name}' is declared as required, but this file supplies a default for it. Declare it optional as '[${name}]'.`,
            startIndex: node.position.start,
            endIndex: node.position.end,
            // Safe to apply unattended: bracketing a name only widens what a caller may
            // omit, so no call site that works today can stop working.
            fix: (corrector) =>
              corrector.replace(
                node.paramName.position.start,
                node.paramName.position.end,
                `[${name}]`,
              ),
          });
        }
      },
    };
  },
};
