import {
  ForMarkup,
  LiquidTag,
  LiquidTagFor,
  LiquidTagTablerow,
} from '@platformos/liquid-html-parser';
import { SourceCodeType, Problem } from '../../../types';
import { editDistance, getValuesInMarkup } from './utils';
import { isLoopLiquidTag } from '../../utils';

// Prefixes of valid markup still being typed (`for x`, `for x in`) stay silent;
// only a wrong word in the `in` position is reported.
export function detectInvalidLoopIn(
  node: LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (!isLoopLiquidTag(node)) return;

  const markup = (node as LiquidTagFor | LiquidTagTablerow).markup as ForMarkup | string;
  if (typeof markup !== 'string' || !markup.trim()) return;

  const tokens = getValuesInMarkup(markup);
  if (tokens.length < 2) return;

  const inToken = tokens[1];
  if (inToken.value === 'in') return;

  const openingTagRange = node.blockStartPosition || node.position;
  const openingTag = node.source.slice(openingTagRange.start, openingTagRange.end);
  const markupOffsetInOpening = openingTag.indexOf(markup);
  if (markupOffsetInOpening < 0) return;

  const startIndex = openingTagRange.start + markupOffsetInOpening;
  const endIndex = startIndex + markup.length;

  const isNearMiss = inToken.value.toLowerCase() === 'in' || editDistance(inToken.value, 'in') <= 1;

  const problem: Problem<SourceCodeType.LiquidHtml> = {
    message:
      `Expected 'in' after the loop variable, found '${inToken.value}'` +
      (isNearMiss ? `. Did you mean 'in'?` : ''),
    startIndex,
    endIndex,
  };

  if (isNearMiss) {
    const replacement =
      markup.slice(0, inToken.index) + 'in' + markup.slice(inToken.index! + inToken.value.length);
    problem.fix = (corrector) => {
      corrector.replace(startIndex, endIndex, replacement);
    };
  }

  return problem;
}
