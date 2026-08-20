import { LiquidHtmlNode, LiquidTag, LiquidVariableOutput } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isWithinRawTagThatDoesNotParseItsContents } from '../utils';
import { EscapedClosingQuote, findUnsupportedStringEscapes } from './detect';

/**
 * `{{ "it's a \"test\"" | escape_javascript }}` -- Liquid has no escape sequences, so the
 * literal ends at the escaped quote and the rest of the intended text is silently dropped.
 * Measured on a live instance: nothing raises, the value is just truncated.
 *
 * ERROR because the value is always wrong, but deliberately NOT in the supervisor's
 * `BLOCKING_CHECKS` -- the platform accepts the file, and blocking it would be a false block.
 *
 * No autofix: swapping the outer quotes is correct Liquid but invalid inside a JSON literal
 * (`JsonLiteralQuoteStyle`, which blocks), and unparsed markup cannot tell the two apart.
 */
export const UnsupportedStringEscape: LiquidCheckDefinition = {
  meta: {
    code: 'UnsupportedStringEscape',
    name: 'Unsupported string escape',
    docs: {
      description:
        'Reports a Liquid string literal whose closing quote is backslash-escaped. Liquid string literals have no escape sequences, so the literal ends at that quote and the remaining text is silently left outside the string.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unsupported-string-escape',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    function check(node: LiquidTag | LiquidVariableOutput, ancestors: LiquidHtmlNode[]) {
      if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

      // THE BOUNDARY: raw markup means the strict grammar refused this node. A JSON literal
      // parses, and there `\"` is a real escape the runtime honours -- reporting it is wrong.
      if (typeof node.markup !== 'string') return;

      // The opening tag, not the block: `{% if %}`'s position spans its children.
      const position = 'blockStartPosition' in node ? node.blockStartPosition : node.position;
      const opening = node.source.slice(position.start, position.end);

      for (const escape of findUnsupportedStringEscapes(opening)) {
        context.report({
          message:
            `String literals have no backslash escapes: \`${escape.literal}\` ends at the ` +
            `escaped \`${escape.quote}\`, so its value is \`${escape.value}\` and ` +
            `\`${escape.outside}\` is left outside the string. ${advice(escape)}`,
          startIndex: position.start + escape.index,
          endIndex: position.start + escape.endIndex,
        });
      }
    }

    return {
      async LiquidTag(node, ancestors) {
        check(node, ancestors);
      },
      async LiquidVariableOutput(node, ancestors) {
        check(node, ancestors);
      },
    };
  },
};

/** A string needing both quote kinds cannot be a Liquid literal at all; it has to be built. */
function advice(escape: EscapedClosingQuote): string {
  const other = escape.quote === '"' ? "'" : '"';
  // between the author's own quotes; the closing one is absent when they never wrote it
  const content = escape.intended.slice(1).replace(new RegExp(`${escape.quote}$`), '');

  if (content.includes(other)) {
    return 'A string containing both quote kinds has to be built with {% capture %}.';
  }

  const rewritten = other + content.split('\\' + escape.quote).join(escape.quote) + other;
  return `Quote it with \`${other}\` instead: \`${rewritten}\`.`;
}
