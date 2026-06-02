/**
 * pos-supervisor:MissingSlug rule — pages without a `slug:` in their front
 * matter. Pre-rule the check landed as `.unmatched` even though the
 * fix-generator already produces an `insert` text_edit
 * (`fixMissingSlugInsert`) that prefills a sensible slug from the file
 * path. This rule promotes the check to a stable rule_id and ships a
 * `guidance` fix that explains *why* the slug matters — the heuristic's
 * literal text_edit remains the actionable diff.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'MissingSlug.default',
    check: 'pos-supervisor:MissingSlug',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'MissingSlug.default',
      hint_md:
        'Page is missing `slug:` in its front matter. Without an explicit slug the platform falls back to ' +
        'a path derived from the filename — fine for one-off pages, but unstable when the file is renamed ' +
        'or moved. Set `slug:` explicitly so URLs are owned by the page, not the filesystem.\n\n' +
        'Conventions:\n' +
        '  • Use kebab-case and avoid the file extension (`slug: contact`, not `slug: contact.liquid`).\n' +
        '  • Use `:param` for dynamic segments (`slug: posts/:id`), not `[param]` (Next.js style).\n' +
        '  • No leading slash — `slug: foo`, not `slug: /foo`.',
      fixes: [{
        type: 'guidance',
        description:
          'Add `slug: <kebab-case-name>` between the front matter `---` markers. ' +
          'The heuristic fix-generator proposes a slug derived from the filename — accept it ' +
          'unless the public URL should diverge from the path.',
      }],
      confidence: 0.85,
      see_also: {
        tool: 'domain_guide',
        args: { domain: 'pages' },
        reason: 'Pages domain guide describes slug conventions and how dynamic segments resolve.',
      },
    }),
  },
];
