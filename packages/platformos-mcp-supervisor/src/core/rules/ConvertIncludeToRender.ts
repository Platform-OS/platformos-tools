/**
 * ConvertIncludeToRender rule — migrate deprecated `{% include %}` to
 * `{% render %}`. The LSP reports the check on every non-module include; this
 * rule attaches the recommendation and stable attribution. A `text_edit`
 * replacement (`include` → `render`) is produced by the heuristic
 * fix-generator in full mode, with a guarded fallback for module-helper
 * includes where the rename is NOT safe.
 *
 * The module-helper guard lives in fix-generator.js (pattern: `include
 * 'modules/...'`). Keeping the skip logic there rather than duplicating it
 * here means one source of truth — this rule just makes sure every include
 * call gets a useful hint and a non-`unmatched` rule_id.
 *
 * Plan reference: Tier 1 trivial wins.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'ConvertIncludeToRender.default',
    check: 'ConvertIncludeToRender',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'ConvertIncludeToRender.default',
      hint_md:
        'Replace `{% include "partial" %}` with `{% render "partial" %}`. `render` has isolated scope — pass every variable the partial needs explicitly: `{% render "partial", var: value %}`. Exception: `include` for **module helpers** (authorization, redirects) is correct because those partials intentionally need shared scope; the heuristic fix-generator detects this and proposes guidance instead of a rename.',
      fixes: [],
      confidence: 0.9,
    }),
  },
];
