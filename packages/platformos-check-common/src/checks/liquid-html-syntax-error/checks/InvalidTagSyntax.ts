import { LiquidTag, NamedTags, TAGS_WITHOUT_MARKUP } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType, TagEntry } from '../../..';

/**
 * Tags that use no markup at all — they are valid as `{% else %}`, `{% break %}`, etc.
 * When their markup is a string, it's always '' (empty), so they should not trigger this check.
 */
const TAGS_WITH_NO_EXPECTED_MARKUP = new Set<string>(TAGS_WITHOUT_MARKUP);

/**
 * Tags that have dedicated sub-checks handling their string-markup cases with
 * more specific error messages and autofixes. This check should NOT fire on these
 * to avoid double-reporting or overriding their nuanced decisions.
 *
 * - assign → MultipleAssignValues, InvalidFilterName, InvalidPipeSyntax
 * - echo → InvalidEchoValue, InvalidFilterName, InvalidPipeSyntax
 * - if/elsif/unless → InvalidConditionalNode, InvalidConditionalNodeParenthesis
 * - for/tablerow → InvalidLoopRange, InvalidLoopArguments
 */
const TAGS_WITH_DEDICATED_CHECKS = new Set<string>([
  NamedTags.assign,
  NamedTags.echo,
  NamedTags.if,
  NamedTags.elsif,
  NamedTags.unless,
  NamedTags.for,
  NamedTags.tablerow,
  NamedTags.when,
]);

/**
 * All tag names in the NamedTags enum — these have specific grammar rules for their markup.
 * If a NamedTag's markup is a string (instead of a parsed object), it means the strict grammar
 * rule failed and the tag fell through to the base case.
 */
const NAMED_TAGS = new Set<string>(Object.values(NamedTags));

/**
 * Detects known tags whose markup couldn't be parsed by the grammar.
 *
 * When the tolerant parser encounters a known tag name (e.g. "render") but can't parse
 * the markup with the strict grammar rule, it falls back to the base case and stores
 * the markup as a raw string. This function detects that situation.
 *
 * This check only applies to tags that DON'T have more specific sub-checks.
 * Tags like assign, echo, if, for etc. have dedicated checks that provide
 * better error messages and autofixes for their specific syntax patterns.
 *
 * Examples:
 *   {% graphql %}              → name: 'graphql', markup: '' (string — invalid)
 *   {% render %}               → name: 'render', markup: '' (string — invalid)
 *   {% function res 'path' %}  → name: 'function', markup: "res 'path'" (string — invalid)
 */
export function detectInvalidTagSyntax(
  node: LiquidTag,
  tags: TagEntry[] = [],
): Problem<SourceCodeType.LiquidHtml> | undefined {
  const tagName = node.name;

  // Only check tags known to the grammar with specific markup rules
  if (!NAMED_TAGS.has(tagName)) {
    return;
  }

  // Tags without expected markup (else, break, continue, etc.) always have string markup
  if (TAGS_WITH_NO_EXPECTED_MARKUP.has(tagName)) {
    return;
  }

  // Skip tags that have dedicated sub-checks with more specific error handling
  if (TAGS_WITH_DEDICATED_CHECKS.has(tagName)) {
    return;
  }

  // If markup is not a string, it was parsed successfully — no error
  if (typeof node.markup !== 'string') {
    return;
  }

  // Build a helpful hint from the docset if available
  const tagEntry = tags.find((t) => t.name === tagName);
  const syntaxHint = tagEntry?.syntax ? ` Expected syntax: ${tagEntry.syntax}` : '';

  return {
    message: `Invalid syntax for tag '${tagName}'${syntaxHint}`,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}
