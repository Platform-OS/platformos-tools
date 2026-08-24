import { LiquidTag } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType } from '../../..';
import { getValuesInMarkup, hasExpressionOperator, INVALID_SYNTAX_MESSAGE } from './utils';
import { findUnsupportedStringEscapes } from '../../unsupported-string-escape/detect';

export function detectMultipleAssignValues(
  node: LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  // Using a regex to match the markup like we do in Shopify/liquid
  // https://github.com/Shopify/liquid/blob/9bb7fbf123e6e2bd61e00189b1c83159f375d3f3/lib/liquid/tags/assign.rb#L21
  //
  // We've broken it up into four groups:
  // 1. The variable name
  // 2. The assignment operator
  // 3. The value section
  // 4. The filter section (non-captured)
  const ASSIGN_MARKUP_REGEX = /([^=]+)(=\s*)([^|]+)(?:\s*\|\s*.*)?$/m;

  if (node.name !== 'assign') {
    return;
  }

  const markup = node.markup;

  if (typeof markup !== 'string') {
    return;
  }

  // `UnsupportedStringEscape` reports the cause. The leftover here is the text the truncated
  // literal spat out, and this fix would DELETE it, making the truncation permanent.
  if (findUnsupportedStringEscapes(markup).length > 0) {
    return;
  }

  const match = markup.match(ASSIGN_MARKUP_REGEX);
  if (!match) {
    return;
  }

  // If we have a markup 'foo    =    "123" something | upcase: 123', we have the following groups
  const [
    // 'foo    =    "123" something | upcase: 123'
    _fullMatch,
    // 'foo    '
    assignmentVariable,
    // '=    '
    assignmentOperator,
    // '"123" something'
    assignmentValue,
  ] = match;

  const firstAssignmentValue = getValuesInMarkup(assignmentValue).at(0)?.value;

  if (!firstAssignmentValue) {
    return;
  }

  const removalIndices = (source: string, startingIndex: number) => {
    const offset = source.indexOf(markup, startingIndex);

    return {
      startIndex:
        offset +
        assignmentVariable.length +
        assignmentOperator.length +
        firstAssignmentValue.length,
      endIndex:
        offset +
        assignmentVariable.length +
        assignmentOperator.length +
        assignmentValue.trimEnd().length,
    };
  };

  const { startIndex, endIndex } = removalIndices(node.source, node.position.start);

  if (endIndex <= startIndex) {
    return;
  }

  if (endIndex <= startIndex) {
    return;
  }

  const problem: Problem<SourceCodeType.LiquidHtml> = {
    message: INVALID_SYNTAX_MESSAGE,
    startIndex,
    endIndex,
  };

  // An operator in the value section means the tail is an OPERAND the author wrote, not a
  // stray token, and this fix would delete it — turning `flag ? 'yes' : 'no'` into `flag`.
  // See `hasExpressionOperator`. The offense still reports; only the fix is withheld.
  if (!hasExpressionOperator(assignmentValue)) {
    problem.fix = (corrector) => {
      corrector.replace(startIndex, endIndex, '');
    };
  }

  return problem;
}
