import { Severity, SourceCodeType, LiquidCheckDefinition } from '../../types';
import { isToleratedTagMarkup } from '../liquid-html-syntax-error/checks/tolerated-tag-markup';

/**
 * Tag markup the grammar refuses that platformOS parses as intended.
 *
 * A separate check code only because `Problem` carries no per-offense severity: these findings
 * come from the same detection as `InvalidTagSyntax`, which reports under
 * `LiquidHTMLSyntaxError` at `Severity.ERROR` and blocks the write. 34 of the 122 syntax errors
 * on a 2,768-file production app were these spellings, all of which run correctly.
 *
 * Stays a warning rather than disappearing: the spellings work by accident, and widening the
 * grammar instead would move the burden to the prettier printer, which today emits this markup
 * verbatim only because it is still a raw string.
 *
 * The admitted set is the allowlist in `tolerated-tag-markup.ts` — read it before adding a shape.
 */
export const UnconventionalTagSyntax: LiquidCheckDefinition = {
  meta: {
    code: 'UnconventionalTagSyntax',
    name: 'Report tag syntax the platform tolerates but does not document',
    docs: {
      description:
        'Reports tag markup that platformOS parses correctly even though it does not match the ' +
        'documented syntax, so the construct can be tidied without the write being refused.',
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/unconventional-tag-syntax',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidTag(node) {
        if (!isToleratedTagMarkup(node)) return;

        context.report({
          message:
            `\`{% ${node.name} ${node.markup} %}\` is not the documented syntax for ` +
            `'${node.name}', but platformOS parses it as intended. It runs correctly; ` +
            `rewrite it in the documented form when convenient.`,
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};
