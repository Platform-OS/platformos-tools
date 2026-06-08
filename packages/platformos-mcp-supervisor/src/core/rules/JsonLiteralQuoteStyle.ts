/**
 * JsonLiteralQuoteStyle rule — pos-cli 6.0.7 inline JSON-literal grammar check.
 *
 * Upstream emits a single constant message when a single-quoted string appears
 * inside a `{ … }` or `[ … ]` literal in `{% assign %}` / `{% return %}` /
 * `{% function %}` arguments. The fix is mechanical: change the quotes to
 * double quotes. The rule attaches a stable rule_id + a quote-swap-flavored
 * hint; the upstream check itself ships an autofix corrector, so we don't
 * duplicate the text_edit here.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'JsonLiteralQuoteStyle.default',
    check: 'JsonLiteralQuoteStyle',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'JsonLiteralQuoteStyle.default',
      hint_md:
        "String literals inside `{ … }` or `[ … ]` JSON literals must be double-quoted. Change the offending single quote to a double quote — the rest of the literal is fine. Liquid string assigns outside JSON literals (`{% assign x = 'hi' %}`) are not affected.",
      fixes: [
        {
          type: 'guidance',
          description:
            'Replace the single-quoted string with a double-quoted equivalent. Example: `{ \'k\': \'v\' }` → `{ "k": "v" }`. The upstream check ships an autofix the agent can accept directly.',
        },
      ],
      confidence: 0.95,
    }),
  },
];
