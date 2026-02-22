import { TextNode } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import {
  REQUIRED_CONTENT_FOR_ARGUMENTS,
  RESERVED_CONTENT_FOR_ARGUMENTS,
} from '../../tags/content-for';
import { isPartial } from '@platformos/platformos-common';

export const ReservedDocParamNames: LiquidCheckDefinition = {
  meta: {
    code: 'ReservedDocParamNames',
    name: 'Valid doc parameter names',
    docs: {
      description:
        'This check exists to ensure any parameter names defined in LiquidDoc do not collide with reserved words.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/reserved-doc-param-names',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const defaultParameterNames = [
      ...REQUIRED_CONTENT_FOR_ARGUMENTS,
      ...RESERVED_CONTENT_FOR_ARGUMENTS,
    ];

    // Does not apply to partials (rendered via `render` tag; param names do not conflict with content_for)
    if (isPartial(context.file.uri)) {
      return {};
    }

    return {
      async LiquidDocParamNode(node) {
        const paramName = node.paramName.value;

        if (defaultParameterNames.includes(paramName)) {
          reportWarning(
            context,
            `The parameter name is not supported because it's a reserved argument for 'content_for' tags.`,
            node.paramName,
          );
        }
      },
    };
  },
};

function reportWarning(context: any, message: string, node: TextNode) {
  context.report({
    message,
    startIndex: node.position.start,
    endIndex: node.position.end,
  });
}
