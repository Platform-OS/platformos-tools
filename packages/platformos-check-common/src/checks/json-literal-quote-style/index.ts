import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

export const JsonLiteralQuoteStyle: LiquidCheckDefinition = {
  meta: {
    code: 'JsonLiteralQuoteStyle',
    name: 'Use double quotes in JSON literals',
    docs: {
      description:
        'Enforces double-quoted string literals inside inline object/array literals (e.g. {% assign a = {"a": 5} %}). Single-quoted strings inside these literals are not valid JSON.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async String(node, ancestors) {
        if (!node.single) return;

        // Only flag strings that are inside an inline object/array literal.
        const insideJsonLiteral = ancestors.some(
          (ancestor) =>
            ancestor.type === NodeTypes.JsonHashLiteral ||
            ancestor.type === NodeTypes.JsonArrayLiteral,
        );
        if (!insideJsonLiteral) return;

        context.report({
          message:
            'Use double quotes for string literals inside object/array literals (e.g. \'{"key": "value"}\', not "{\'key\': \'value\'}").',
          startIndex: node.position.start,
          endIndex: node.position.end,
          fix: (corrector) => {
            corrector.replace(node.position.start, node.position.end, JSON.stringify(node.value));
          },
        });
      },
    };
  },
};
