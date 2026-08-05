import { LiquidBranch } from '@platformos/liquid-html-parser';
import { SourceCodeType, Problem } from '../../../types';
import { INVALID_SYNTAX_MESSAGE } from './utils';

const WHEN_VALUE = /^('[^']*'|"[^"]*"|[^\s,]+)/;
const WHEN_SEPARATOR = /^(\s*,\s*|\s+or\s+)/;

// Walks the raw markup, not tokens — tokenization strips commas, making the invalid
// `1 huh 2` identical to the valid `1, huh, 2`.
export function detectInvalidWhenMarkup(
  node: LiquidBranch,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (node.name !== 'when') return;

  const markup = node.markup;
  if (typeof markup !== 'string' || !markup.trim()) return;

  const start = markup.length - markup.trimStart().length;
  let pos = start;
  let consumedEnd = start;

  while (true) {
    const value = markup.slice(pos).match(WHEN_VALUE);
    if (!value) break;
    pos += value[0].length;
    consumedEnd = pos;
    const separator = markup.slice(pos).match(WHEN_SEPARATOR);
    if (!separator) break;
    pos += separator[0].length;
  }

  if (!markup.slice(consumedEnd).trim()) return;

  const consumed = markup.slice(start, consumedEnd);

  const openingTagRange = node.blockStartPosition || node.position;
  const openingTag = node.source.slice(openingTagRange.start, openingTagRange.end);
  const markupOffsetInOpening = openingTag.indexOf(markup);
  if (markupOffsetInOpening < 0) return;

  const startIndex = openingTagRange.start + markupOffsetInOpening;
  const endIndex = startIndex + markup.length;

  return {
    message: `${INVALID_SYNTAX_MESSAGE}: 'when' values are separated by ',' or 'or'. Anything after '${consumed}' will be ignored`,
    startIndex,
    endIndex,
    fix: (corrector) => {
      corrector.replace(startIndex, endIndex, consumed);
    },
  };
}
