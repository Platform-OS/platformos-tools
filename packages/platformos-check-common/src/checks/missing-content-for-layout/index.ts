import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isLayout } from '../../path';

/**
 * Ensures every layout outputs `{{ content_for_layout }}`.
 *
 * `content_for_layout` is where platformOS injects the rendered page body. A
 * layout that never references it renders its own chrome but drops the page
 * entirely — a correctness defect, not a style issue. (Named slots use
 * `{% yield 'name' %}` separately and do not substitute for it.)
 *
 * The check is scoped to layout files via `getFileType` (re-exported as
 * `isLayout`) so it never fires on pages or partials. Detection is AST-based —
 * any reference to the `content_for_layout` variable counts, whether emitted
 * with `{{ … }}`, `{% echo … %}`, or inside a `{% liquid %}` block — which is
 * stricter-yet-safer than a raw `{{ content_for_layout }}` text match.
 */

const CONTENT_FOR_LAYOUT = 'content_for_layout';
const BODY_CLOSE = /<\/body\s*>/i;

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
    if (!isLayout(context.file.uri)) return {};

    let referencesContentForLayout = false;

    return {
      async VariableLookup(node) {
        if (node.name === CONTENT_FOR_LAYOUT) {
          referencesContentForLayout = true;
        }
      },

      async onCodePathEnd() {
        if (referencesContentForLayout) return;

        const source = context.file.source;
        const bodyClose = source.search(BODY_CLOSE);
        // Insert just before `</body>` when present (keeps it inside the body),
        // otherwise append at the end of the layout.
        const insertAt = bodyClose !== -1 ? bodyClose : source.length;
        const insertText =
          bodyClose !== -1 ? '{{ content_for_layout }}\n' : '\n{{ content_for_layout }}\n';
        const suggestMessage =
          bodyClose !== -1
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
