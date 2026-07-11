import { NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { getFileType, PlatformOSFileType } from '../../path';

/**
 * Ensures every layout outputs `{{ content_for_layout }}`.
 *
 * `content_for_layout` is where platformOS injects the rendered page body. A
 * layout that never references it renders its own chrome but drops the page
 * entirely — a correctness defect, not a style issue. (Named slots use
 * `{% yield 'name' %}` separately and do not substitute for it.)
 *
 * The check is scoped to layout files via the canonical
 * `PlatformOSFileType.Layout` (the single source of truth shared with
 * DocumentsLocator's `'layout'` type and the graph's layout edge), so it never
 * fires on pages or partials. Both detection and the
 * suggested fix are AST-based: any reference to the `content_for_layout`
 * variable clears the check (whether emitted with `{{ … }}`, `{% echo … %}`,
 * or inside a `{% liquid %}` block), and the fix is inserted before the
 * `<body>` element's closing tag — using the parsed element's position, never
 * a text scan of the raw source.
 */

const CONTENT_FOR_LAYOUT = 'content_for_layout';

export const MissingContentForLayout: LiquidCheckDefinition = {
  meta: {
    code: 'MissingContentForLayout',
    name: 'Missing Content For Layout',
    docs: {
      description:
        'Ensures every layout references `content_for_layout` — without it the rendered page body is never output.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    // Scope to layout files only; pages/partials/etc. must not be flagged.
    if (getFileType(context.file.uri) !== PlatformOSFileType.Layout) return {};

    let referencesContentForLayout = false;
    // Start index of the `</body>` closing tag, captured from the AST so the
    // fix never has to scan the raw source for it.
    let bodyCloseIndex: number | undefined;

    return {
      async VariableLookup(node) {
        if (node.name === CONTENT_FOR_LAYOUT) {
          referencesContentForLayout = true;
        }
      },

      async HtmlElement(node) {
        if (bodyCloseIndex !== undefined) return; // first <body> wins
        const tagName = node.name[0];
        if (tagName?.type === NodeTypes.TextNode && tagName.value.toLowerCase() === 'body') {
          bodyCloseIndex = node.blockEndPosition.start;
        }
      },

      async onCodePathEnd(file) {
        if (referencesContentForLayout) return;

        // Insert before `</body>` when the layout has one (keeps it inside the
        // body); otherwise append at the end of the document. Both positions
        // come from the AST.
        const hasBody = bodyCloseIndex !== undefined;
        const insertAt = hasBody ? bodyCloseIndex! : file.ast.position.end;
        const insertText = hasBody ? '{{ content_for_layout }}\n' : '\n{{ content_for_layout }}\n';
        const suggestMessage = hasBody
          ? 'Insert `{{ content_for_layout }}` before the closing </body> tag'
          : 'Insert `{{ content_for_layout }}` at the end of the layout';

        context.report({
          message:
            "Layout is missing `{{ content_for_layout }}`. Every layout must output it exactly once — it renders the page body. (Named slots use `{% yield 'name' %}` separately and do not replace it.)",
          startIndex: 0,
          endIndex: 0,
          suggest: [
            {
              message: suggestMessage,
              fix: (corrector) => {
                corrector.insert(insertAt, insertText);
              },
            },
          ],
        });
      },
    };
  },
};
