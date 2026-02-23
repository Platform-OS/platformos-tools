import { HtmlRawNode } from '@platformos/liquid-html-parser';
import { LiquidHtmlSuggestion } from '../../types';

const suggestionMessage = (attr: 'defer' | 'async') =>
  `Use an HTML script tag with the ${attr} attribute instead`;

export const scriptTagSuggestion = (
  attr: 'defer' | 'async',
  node: HtmlRawNode,
): LiquidHtmlSuggestion => ({
  message: suggestionMessage(attr),
  fix(corrector) {
    corrector.insert(node.blockStartPosition.end - 1, ` ${attr}`);
  },
});
