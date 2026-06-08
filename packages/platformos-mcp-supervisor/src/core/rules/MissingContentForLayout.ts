/**
 * pos-supervisor:MissingContentForLayout rule — layouts missing
 * `{{ content_for_layout }}`. Pre-rule the check landed as `.unmatched`
 * even though fix-generator's `fixMissingContentForLayout` already inserts
 * the placeholder after `<body>` (or at line 0 if no body tag exists).
 *
 * The rule attaches stable attribution and a `guidance` fix that explains
 * the relationship between `{{ content_for_layout }}` and named `{% yield %}`
 * slots — the heuristic's `insert` text_edit is the actionable diff.
 */
import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'MissingContentForLayout.default',
    check: 'pos-supervisor:MissingContentForLayout',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'MissingContentForLayout.default',
      hint_md:
        'Every layout MUST include `{{ content_for_layout }}` exactly once — that is where the page body ' +
        'is rendered into. Without it, pages using this layout serve only the layout chrome (header / nav / ' +
        'footer) and the page-specific content silently disappears.\n\n' +
        'Distinction:\n' +
        '  • `{{ content_for_layout }}` — the implicit "page body" slot. Every layout has exactly one.\n' +
        '  • `{% yield "name" %}` — named, optional slots a page can fill via `{% content_for "name" %}`. ' +
        'Use these for sidebars, head injection, etc. Adding more named slots does NOT replace the ' +
        'implicit body slot.',
      fixes: [
        {
          type: 'guidance',
          description:
            'Insert `{{ content_for_layout }}` once in the layout — typically right after the `<body>` tag. ' +
            'The heuristic fix-generator emits the literal `insert` text_edit; accept it. ' +
            'Add named `{% yield "name" %}` slots only when pages need extra fill points.',
        },
      ],
      confidence: 0.95,
      see_also: {
        tool: 'domain_guide',
        args: { domain: 'layouts' },
        reason:
          'Layouts domain guide explains content_for_layout vs yield and shows the canonical layout shape.',
      },
    }),
  },
];
