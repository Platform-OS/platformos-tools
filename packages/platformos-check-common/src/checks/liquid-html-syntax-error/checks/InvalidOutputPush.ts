import { LiquidTag, LiquidVariableOutput, NodeTypes } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType } from '../../..';

const PUSH_OPERATOR_MESSAGE =
  "The '<<' (push) operator is only valid inside '{% assign target << value %}'. Remove it or move the expression into an assign tag.";

/**
 * Detects misuse of the `<<` (array push) operator inside output positions:
 *
 *   {{ arr << "el" }}             — invalid
 *   {% echo arr << "el" %}        — invalid
 *
 * `<<` is only accepted as the top-level operator in an assign tag:
 *
 *   {% assign arr << "el" %}      — valid (pushes "el" onto arr)
 *
 * Runtime rejects output-position push with a hard syntax error; this check
 * mirrors that with a clearer, actionable message than the generic
 * `InvalidEchoValue` fallback ("Syntax is not supported").
 */
export function detectInvalidOutputPush(
  node: LiquidTag | LiquidVariableOutput,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (node.type === NodeTypes.LiquidTag && node.name !== 'echo') return;

  const markup = node.markup;
  if (typeof markup !== 'string' || !markup) return;

  // Strip quoted strings so literal `<<` inside a string doesn't trigger the check
  // (e.g. `{{ "a << b" }}` is a harmless string with no push operator).
  const stripped = markup.replace(/'[^']*'|"[^"]*"/g, '');
  if (!/<</.test(stripped)) return;

  return {
    message: PUSH_OPERATOR_MESSAGE,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}
