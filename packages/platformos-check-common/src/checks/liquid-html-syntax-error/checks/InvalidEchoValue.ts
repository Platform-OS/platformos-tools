import { LiquidTag, LiquidVariableOutput, NodeTypes } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType } from '../../..';
import { getValuesInMarkup, hasExpressionOperator, INVALID_SYNTAX_MESSAGE } from './utils';
import { findUnsupportedStringEscapes } from '../../unsupported-string-escape/detect';

export function detectInvalidEchoValue(
  node: LiquidTag | LiquidVariableOutput,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  // We've broken it up into two groups:
  // 1. The variable(s)
  // 2. The filter section (non-captured)
  const ECHO_MARKUP_REGEX = /([^|]*)(?:\s*\|\s*.*)?$/m;

  if (node.type === NodeTypes.LiquidTag && node.name !== 'echo') {
    return;
  }

  const markup = node.markup;

  if (
    typeof markup !== 'string' ||
    // echo tags and variable outputs without markup are strict-valid:
    // e.g. {{ }}, {% echo %}, and {% liquid echo %}
    !markup
  ) {
    return;
  }

  // `UnsupportedStringEscape` reports the cause. The leftover here is the text the truncated
  // literal spat out, and this fix would DELETE it, making the truncation permanent.
  if (findUnsupportedStringEscapes(markup).length > 0) {
    return;
  }

  const match = markup.match(ECHO_MARKUP_REGEX);
  if (!match) {
    return;
  }

  const [, echoValue] = match;

  const firstEchoValue = getValuesInMarkup(echoValue).at(0)?.value;

  if (!firstEchoValue) {
    const startIndex = node.source.indexOf(markup, node.position.start);
    const endIndex = startIndex + markup.length;

    return {
      message: INVALID_SYNTAX_MESSAGE,
      startIndex,
      endIndex,
      fix: (corrector) => {
        corrector.replace(startIndex, endIndex, 'blank');
      },
    };
  }

  const removalIndices = (source: string, startingIndex: number) => {
    const offset = source.indexOf(markup, startingIndex);

    return {
      startIndex: offset + firstEchoValue.length,
      endIndex: offset + echoValue.trimEnd().length,
    };
  };

  const { startIndex, endIndex } = removalIndices(node.source, node.position.start);

  if (endIndex <= startIndex) {
    return;
  }

  const problem: Problem<SourceCodeType.LiquidHtml> = {
    message: INVALID_SYNTAX_MESSAGE,
    startIndex,
    endIndex,
  };

  // An operator in the value section means the tail is an OPERAND the author wrote, not a
  // stray token, and this fix would delete it — turning `{{ flag ? 'yes' : 'no' }}` into
  // `{{ flag }}`. See `hasExpressionOperator`. The offense still reports; only the fix is
  // withheld. Covers `{% echo %}`, `{% liquid echo %}` and `{{ }}` alike.
  if (!hasExpressionOperator(echoValue)) {
    problem.fix = (corrector) => {
      corrector.replace(startIndex, endIndex, '');
    };
  }

  return problem;
}
