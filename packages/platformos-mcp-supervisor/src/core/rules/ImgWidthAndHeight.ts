/**
 * ImgWidthAndHeight rule — layout-shift hint. The LSP flags an `<img>` without
 * explicit `width` and/or `height`; this rule attaches guidance and stable
 * attribution. The `text_edit` insert is produced by the heuristic
 * fix-generator (full mode); the rule keeps quick-mode diagnostics usefully
 * labelled.
 *
 * Plan reference: Tier 1 trivial wins.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'ImgWidthAndHeight.recommended',
    check: 'ImgWidthAndHeight',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'ImgWidthAndHeight.recommended',
      hint_md:
        'Add explicit `width` and `height` attributes to this `<img>` tag. The browser uses them to reserve space before the image loads, eliminating cumulative layout shift (CLS). For responsive images, set the attributes to the intrinsic dimensions and override with CSS (`style="width:100%;height:auto"`).',
      fixes: [],
      confidence: 0.9,
    }),
  },
];
