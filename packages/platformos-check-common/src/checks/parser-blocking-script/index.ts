import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { hasAttributeValueOf, isAttr, isHtmlAttribute, isValuedHtmlAttribute } from '../utils';
import { scriptTagSuggestion } from './suggestions';

export const ParserBlockingScript: LiquidCheckDefinition = {
  meta: {
    code: 'ParserBlockingScript',
    aliases: ['ParserBlockingScriptTag'],
    name: 'Avoid parser blocking scripts',
    docs: {
      description: 'Parser-blocking scripts delay page rendering by blocking the HTML parser.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/parser-blocking-script',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      // <script src="...">
      HtmlRawNode: async (node) => {
        if (node.name !== 'script') {
          return;
        }

        const hasSrc = node.attributes
          .filter(isValuedHtmlAttribute)
          .some((attr) => isAttr(attr, 'src'));

        if (!hasSrc) {
          return;
        }

        const hasDeferOrAsync = node.attributes
          .filter(isHtmlAttribute)
          .some((attr) => isAttr(attr, 'async') || isAttr(attr, 'defer'));
        const isTypeModule = node.attributes
          .filter(isValuedHtmlAttribute)
          .some(
            (attr) =>
              isAttr(attr, 'type') &&
              (hasAttributeValueOf(attr, 'module') || hasAttributeValueOf(attr, 'importmap')),
          );

        if (hasDeferOrAsync || isTypeModule) {
          return;
        }

        context.report({
          message: 'Avoid parser blocking scripts by adding `defer` or `async` on this tag',
          startIndex: node.position.start,
          endIndex: node.position.end,
          suggest: [scriptTagSuggestion('defer', node), scriptTagSuggestion('async', node)],
        });
      },
    };
  },
};
