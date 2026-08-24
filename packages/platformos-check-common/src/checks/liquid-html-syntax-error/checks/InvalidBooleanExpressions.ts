import { LiquidBooleanExpression, LiquidHtmlNode, NodeTypes } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType } from '../../..';
import { INVALID_SYNTAX_MESSAGE } from './utils';
import { isWithinRawTagThatDoesNotParseItsContents } from '../../utils';

export function detectInvalidBooleanExpressions(
  node: LiquidBooleanExpression,
  ancestors: LiquidHtmlNode[],
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

  const condition = node.condition;
  if (condition.type !== NodeTypes.Comparison && condition.type !== NodeTypes.LogicalExpression) {
    return;
  }

  /**
   * REPORTED, never fixed.
   *
   * This node is by construction a comparison or a logical expression the author WROTE, so
   * there is no stray-token reading of it: every operand and the operator itself carry
   * meaning. The fix that used to live here replaced the whole expression with
   * `condition.left`, which is a silent rewrite rather than a repair —
   * `{% assign foo = something == else %}` became `{% assign foo = something %}`.
   *
   * That mattered because the deploy converter REJECTS the original (measured:
   * `{% assign x = a == b %}` → "Expected end_of_string but found comparison") and ACCEPTS
   * the rewrite. `pos-cli check run -a` therefore turned a loud, blocking failure into a
   * working page holding a value the author never wrote, and reported "No offenses found".
   *
   * The offense itself is the mitigation: `LiquidHTMLSyntaxError` blocks the write, which is
   * the only thing standing between this syntax and a wrong value at runtime.
   *
   * See `hasExpressionOperator` in `./utils` for the same argument applied to the detectors
   * that work on raw string markup instead of a parsed node.
   */
  return {
    message: INVALID_SYNTAX_MESSAGE,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}
